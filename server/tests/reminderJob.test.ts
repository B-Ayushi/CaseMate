import nodemailer from 'nodemailer';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimReminder, runReminderCycle, type ReminderJobDeps } from '../src/jobs/reminderJob.js';
import { reminderTick } from '../src/jobs/scheduler.js';
import { createMailer, type MailMessage } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';
import { createUnconfiguredSmsProvider, type SmsProvider } from '../src/lib/sms.js';
import { istDateString, istDateTimeToUtc } from '../src/lib/time.js';
import { buildTestApp, resetDatabase, signUpLawyer, TEST_CLIENT_URL } from './helpers.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const hearingDay = istDateString(new Date(Date.now() + 10 * DAY));
const hearingAt = istDateTimeToUtc(hearingDay, '10:30');
const dayBeforeDue = new Date(hearingAt.getTime() - DAY + MIN);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Email goes through the real mailer and Nodemailer (JSON transport, no delivery).
// SMS goes to a recording provider that implements the same SmsProvider interface as
// Twilio; tests cannot send real text messages. `failTimes` makes the first sends throw,
// and `delayMs` slows every send down so overlapping runs really overlap.
function deps(options: { sms?: SmsProvider; failTimes?: number; delayMs?: number } = {}) {
  const emails: MailMessage[] = [];
  const texts: { to: string; body: string }[] = [];
  let failuresLeft = options.failTimes ?? 0;
  const mailer = createMailer(
    nodemailer.createTransport({ jsonTransport: true }),
    'test@casemate.invalid',
  );
  const jobDeps: ReminderJobDeps = {
    prisma,
    clientUrl: TEST_CLIENT_URL,
    mailer: {
      async send(message) {
        if (options.delayMs) await sleep(options.delayMs);
        await mailer.send(message);
        emails.push(message);
      },
    },
    sms: options.sms ?? {
      name: 'recorder',
      async send(to, body) {
        if (options.delayMs) await sleep(options.delayMs);
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error('Gateway timeout');
        }
        texts.push({ to, body });
      },
    },
  };
  return { jobDeps, emails, texts };
}

async function lawyerWithCases(count = 1, overrides: Record<string, unknown> = {}) {
  const { app } = buildTestApp();
  const { cookie, lawyer } = await signUpLawyer(app, { phone: '9822012345' });
  const as = (r: request.Test) => r.set('Cookie', cookie);
  const client = (
    await as(request(app).post('/api/clients')).send({ name: 'Ramesh Gupta', phone: '9822011223' })
  ).body.client;

  const hearingIds: string[] = [];
  let caseId = '';
  for (let i = 0; i < count; i++) {
    const created = await as(request(app).post('/api/cases')).send({
      clientId: client.id,
      title: 'Gupta vs. Mehta Builders',
      caseNumber: i === 0 ? 'RCS/412/2026' : `RCS/${500 + i}/2026`,
      courtName: 'Civil Court, Pune',
      courtroom: 'Room 4',
      firstHearing: {
        date: hearingDay,
        time: '10:30',
        purpose: 'Evidence',
        notes: 'Bring the sale agreement',
      },
      ...overrides,
    });
    expect(created.status).toBe(201);
    caseId ||= created.body.case.id;
    const hearing = await prisma.hearing.findFirstOrThrow({
      where: { caseId: created.body.case.id },
    });
    hearingIds.push(hearing.id);
  }
  return { app, as, lawyer, caseId, hearingId: hearingIds[0]!, hearingIds };
}

const caseWithHearing = () => lawyerWithCases(1);

const statuses = async (hearingId: string) =>
  Object.fromEntries(
    (await prisma.reminder.findMany({ where: { hearingId } })).map((r) => [
      `${r.type}/${r.channel}`,
      r.status,
    ]),
  );

const reminderOf = (hearingId: string, type: string, channel: string) =>
  prisma.reminder.findFirstOrThrow({
    where: {
      hearingId,
      type: type as 'DAY_BEFORE',
      channel: channel as 'SMS',
      status: { not: 'CANCELLED' },
    },
  });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('claiming', () => {
  it('claims a due reminder exactly once, and never one that is not due', async () => {
    const { hearingId } = await caseWithHearing();
    const reminder = await reminderOf(hearingId, 'DAY_BEFORE', 'EMAIL');

    expect(await claimReminder(prisma, reminder, new Date(dayBeforeDue.getTime() - 2 * MIN))).toBe(
      false,
    );
    const both = await Promise.all([
      claimReminder(prisma, reminder, dayBeforeDue),
      claimReminder(prisma, reminder, dayBeforeDue),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe(
      'SENDING',
    );
  });

  it('a run holding an old copy cannot claim a reminder another run has rescheduled', async () => {
    const { hearingId } = await caseWithHearing();
    const snapshot = await reminderOf(hearingId, 'DAY_BEFORE', 'SMS');

    // Another run tried it, failed, and put it back with a retry 5 minutes later.
    await prisma.reminder.update({
      where: { id: snapshot.id },
      data: { attempts: 1, nextAttemptAt: new Date(dayBeforeDue.getTime() + 5 * MIN) },
    });

    expect(await claimReminder(prisma, snapshot, dayBeforeDue)).toBe(false);
    const fresh = await prisma.reminder.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(await claimReminder(prisma, fresh, dayBeforeDue)).toBe(false);
    expect(await claimReminder(prisma, fresh, new Date(dayBeforeDue.getTime() + 5 * MIN))).toBe(
      true,
    );
  });

  it('overlapping runs on two server instances send every reminder exactly once', async () => {
    const { hearingIds } = await lawyerWithCases(3);
    const serverA = deps({ delayMs: 25 });
    const serverB = deps({ delayMs: 25 });

    const results = await Promise.all([
      runReminderCycle(serverA.jobDeps, dayBeforeDue),
      runReminderCycle(serverB.jobDeps, dayBeforeDue),
      runReminderCycle(serverA.jobDeps, dayBeforeDue),
      runReminderCycle(serverB.jobDeps, dayBeforeDue),
    ]);

    // 3 hearings x (day-before email + day-before SMS) = 6 reminders.
    expect(results.reduce((n, r) => n + r.claimed, 0)).toBe(6);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(6);
    expect(serverA.emails.length + serverB.emails.length).toBe(3);
    expect(serverA.texts.length + serverB.texts.length).toBe(3);
    for (const id of hearingIds) {
      expect(await statuses(id)).toMatchObject({
        'DAY_BEFORE/EMAIL': 'SENT',
        'DAY_BEFORE/SMS': 'SENT',
      });
    }

    // And nothing goes out again later.
    const again = await runReminderCycle(serverA.jobDeps, new Date(dayBeforeDue.getTime() + MIN));
    expect(again.claimed).toBe(0);
  });
});

describe('reminder delivery', () => {
  it('sends the day-before email and SMS when due, once only', async () => {
    const { hearingId, lawyer } = await caseWithHearing();
    const { jobDeps, emails, texts } = deps();

    // A minute before they are due: nothing.
    expect((await runReminderCycle(jobDeps, new Date(hearingAt.getTime() - DAY - MIN))).sent).toBe(
      0,
    );

    expect((await runReminderCycle(jobDeps, dayBeforeDue)).sent).toBe(2);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toBe(lawyer.email);
    expect(emails[0]!.subject).toBe(
      'Tomorrow 10:30 AM: Gupta vs. Mehta Builders at Civil Court, Pune, Room 4',
    );
    expect(emails[0]!.text).toContain('Your note: Bring the sale agreement');
    expect(emails[0]!.text).toContain(`${TEST_CLIENT_URL}/cases/`);
    expect(texts).toEqual([
      {
        to: '+919822012345',
        body: expect.stringMatching(
          /^CaseMate: Hearing tomorrow .* 10:30 AM \| Gupta vs\. Mehta Builders \(RCS\/412\/2026\) \| Civil Court, Pune, Room 4 \| Purpose: Evidence/,
        ),
      },
    ]);

    await runReminderCycle(jobDeps, dayBeforeDue);
    expect(emails).toHaveLength(1);
    expect(texts).toHaveLength(1);
    expect(await statuses(hearingId)).toMatchObject({
      'DAY_BEFORE/EMAIL': 'SENT',
      'DAY_BEFORE/SMS': 'SENT',
    });
  });

  it('normalises the phone number to +91 before handing it to the SMS provider', async () => {
    const { lawyer } = await caseWithHearing();
    // A number saved in another format, for example before validation was tightened.
    await prisma.lawyer.update({ where: { id: lawyer.id }, data: { phone: '098220-12345' } });
    const { jobDeps, texts } = deps();

    await runReminderCycle(jobDeps, dayBeforeDue);
    expect(texts.map((t) => t.to)).toEqual(['+919822012345']);
  });

  it('sends the 2-hour SMS and the 6 PM missing-outcome email', async () => {
    const { hearingId } = await caseWithHearing();
    const { jobDeps, emails, texts } = deps();

    await runReminderCycle(jobDeps, new Date(hearingAt.getTime() - 2 * HOUR + MIN));
    expect(texts.at(-1)!.body).toMatch(/^CaseMate: Hearing today at 10:30 AM/);

    await runReminderCycle(jobDeps, istDateTimeToUtc(hearingDay, '18:01'));
    expect(emails.at(-1)!.subject).toBe('Log the outcome: Gupta vs. Mehta Builders');
    expect(await statuses(hearingId)).toMatchObject({
      'TWO_HOUR/SMS': 'SENT',
      'MISSING_OUTCOME/EMAIL': 'SENT',
    });
  });

  it('cancels a reminder that would arrive after the hearing started', async () => {
    const { hearingId } = await caseWithHearing();
    const { jobDeps, texts } = deps();

    const result = await runReminderCycle(jobDeps, new Date(hearingAt.getTime() + 30 * MIN));

    expect(texts).toHaveLength(0);
    expect(result.cancelled).toBe(3);
    const rows = await prisma.reminder.findMany({
      where: { hearingId, type: { not: 'MISSING_OUTCOME' } },
    });
    expect(
      rows.every((r) => r.status === 'CANCELLED' && r.lastError?.includes('already started')),
    ).toBe(true);
  });

  it('never re-sends a reminder that was interrupted mid-send', async () => {
    const { hearingId } = await caseWithHearing();
    const { jobDeps, emails } = deps();
    const reminder = await reminderOf(hearingId, 'DAY_BEFORE', 'EMAIL');
    await prisma.$executeRaw`UPDATE reminders SET status = 'SENDING', updatedAt = ${new Date(Date.now() - HOUR)} WHERE id = ${reminder.id}`;

    await runReminderCycle(jobDeps, dayBeforeDue);

    expect(emails).toHaveLength(0);
    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(after.status).toBe('FAILED');
    expect(after.lastError).toMatch(/interrupted/);
  });

  it('logs one compact line per run', async () => {
    await caseWithHearing();
    const { jobDeps } = deps();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await reminderTick(jobDeps, dayBeforeDue);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]![0]).toMatch(
        /^\[reminders\] claimed=2 sent=2 failed=0 cancelled=0 retrying=0 summaries=0 \(\d+ms\)$/,
      );
    } finally {
      log.mockRestore();
    }
  });
});

describe('retries', () => {
  it('retries after 5, 10 and 15 minutes, then marks it FAILED with the reason', async () => {
    const { hearingId } = await caseWithHearing();
    const { jobDeps } = deps({ sms: createUnconfiguredSmsProvider() });
    let now = dayBeforeDue;

    for (const [attempt, delay] of [
      [1, 5],
      [2, 10],
      [3, 15],
    ] as const) {
      const result = await runReminderCycle(jobDeps, now);
      expect(result.retrying).toBe(1);
      const sms = await reminderOf(hearingId, 'DAY_BEFORE', 'SMS');
      expect(sms).toMatchObject({ status: 'PENDING', attempts: attempt });
      expect(sms.lastError).toMatch(/SMS is not configured/);
      expect(sms.nextAttemptAt!.getTime() - now.getTime()).toBe(delay * MIN);

      // Not retried before its next attempt time.
      const early = await runReminderCycle(jobDeps, new Date(sms.nextAttemptAt!.getTime() - MIN));
      expect(early.claimed).toBe(0);
      now = sms.nextAttemptAt!;
    }

    const last = await runReminderCycle(jobDeps, now);
    expect(last).toMatchObject({ claimed: 1, failed: 1, retrying: 0 });
    const failed = await reminderOf(hearingId, 'DAY_BEFORE', 'SMS');
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 4, nextAttemptAt: null });
    expect(failed.lastError).toMatch(/SMS is not configured/);

    // A FAILED reminder is never picked up again.
    expect((await runReminderCycle(jobDeps, new Date(now.getTime() + HOUR))).claimed).toBe(0);
    // The email went out on the first run regardless.
    expect((await statuses(hearingId))['DAY_BEFORE/EMAIL']).toBe('SENT');
  });

  it('a retry that succeeds is marked SENT and delivered once', async () => {
    const { hearingId } = await caseWithHearing();
    const { jobDeps, texts } = deps({ failTimes: 1 });

    await runReminderCycle(jobDeps, dayBeforeDue);
    expect(texts).toHaveLength(0);
    await runReminderCycle(jobDeps, new Date(dayBeforeDue.getTime() + 5 * MIN));
    await runReminderCycle(jobDeps, new Date(dayBeforeDue.getTime() + 10 * MIN));

    expect(texts).toHaveLength(1);
    expect(await reminderOf(hearingId, 'DAY_BEFORE', 'SMS')).toMatchObject({
      status: 'SENT',
      attempts: 2,
      lastError: null,
    });
  });
});

describe('when a hearing changes', () => {
  it('moving a hearing cancels the old reminders and sends new ones at the new time', async () => {
    const { app, as, hearingId } = await caseWithHearing();
    const { jobDeps, emails, texts } = deps();
    const newDay = istDateString(new Date(hearingAt.getTime() + 2 * DAY));
    const newAt = istDateTimeToUtc(newDay, '14:00');

    const moved = await as(request(app).put(`/api/hearings/${hearingId}`)).send({
      date: newDay,
      time: '14:00',
      purpose: 'Evidence',
      notes: null,
    });
    expect(moved.status).toBe(200);

    // At the old time: nothing is sent.
    expect((await runReminderCycle(jobDeps, dayBeforeDue)).claimed).toBe(0);
    expect(emails).toHaveLength(0);
    expect(texts).toHaveLength(0);

    // At the new time: sent once.
    expect((await runReminderCycle(jobDeps, new Date(newAt.getTime() - DAY + MIN))).sent).toBe(2);
    expect(emails[0]!.subject).toMatch(/^Tomorrow 2:00 PM/);
    const rows = await prisma.reminder.findMany({ where: { hearingId, type: 'DAY_BEFORE' } });
    expect(rows.filter((r) => r.status === 'CANCELLED')).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(2);
  });

  it('re-checks the hearing just before sending and cancels if it has moved', async () => {
    const { hearingId } = await caseWithHearing();
    const { jobDeps, emails, texts } = deps();
    // The hearing moves in the instant between planning and sending (the reminder rows
    // have not been re-planned yet).
    await prisma.hearing.update({
      where: { id: hearingId },
      data: { scheduledAt: new Date(hearingAt.getTime() + 3 * HOUR) },
    });

    const result = await runReminderCycle(jobDeps, dayBeforeDue);

    expect(result).toMatchObject({ claimed: 2, sent: 0, cancelled: 2 });
    expect(emails).toHaveLength(0);
    expect(texts).toHaveLength(0);
    const sms = await prisma.reminder.findFirstOrThrow({
      where: { hearingId, type: 'DAY_BEFORE', channel: 'SMS' },
    });
    expect(sms.status).toBe('CANCELLED');
    expect(sms.lastError).toMatch(/^The hearing was moved to .* 1:30 PM IST\.$/);
  });

  it('cancels instead of sending when the hearing was cancelled or the case closed', async () => {
    const first = await lawyerWithCases(2);
    const { jobDeps, emails, texts } = deps();
    await prisma.hearing.update({
      where: { id: first.hearingIds[0] },
      data: { status: 'CANCELLED' },
    });
    const otherCase = await prisma.hearing.findUniqueOrThrow({
      where: { id: first.hearingIds[1] },
    });
    await prisma.case.update({ where: { id: otherCase.caseId }, data: { status: 'CLOSED' } });

    const result = await runReminderCycle(jobDeps, dayBeforeDue);

    expect(result).toMatchObject({ claimed: 4, sent: 0, cancelled: 4 });
    expect(emails.length + texts.length).toBe(0);
    const reasons = (await prisma.reminder.findMany({ where: { status: 'CANCELLED' } })).map(
      (r) => r.lastError,
    );
    expect(reasons).toContain('The hearing was cancelled.');
    expect(reasons).toContain('The case is closed.');
  });

  it('does not send a reminder that was turned off for the case after it was planned', async () => {
    const { caseId, hearingId } = await caseWithHearing();
    const { jobDeps, emails, texts } = deps();
    await prisma.case.update({ where: { id: caseId }, data: { smsReminderOverride: false } });

    await runReminderCycle(jobDeps, dayBeforeDue);

    expect(emails).toHaveLength(1);
    expect(texts).toHaveLength(0);
    const sms = await prisma.reminder.findFirstOrThrow({
      where: { hearingId, type: 'DAY_BEFORE', channel: 'SMS' },
    });
    expect(sms).toMatchObject({
      status: 'CANCELLED',
      lastError: 'This reminder was turned off in Settings or for this case.',
    });
  });
});

describe('daily summary', () => {
  it('is created at 7:00 AM IST on a hearing day and sent once', async () => {
    const { lawyer } = await caseWithHearing();
    const { jobDeps, emails } = deps();

    await runReminderCycle(jobDeps, istDateTimeToUtc(hearingDay, '06:59'));
    expect(emails.some((e) => e.subject.includes('hearing today'))).toBe(false);

    const at7 = istDateTimeToUtc(hearingDay, '07:01');
    const result = await runReminderCycle(jobDeps, at7);
    expect(result.summariesCreated).toBe(1);
    const summary = emails.find((e) => e.subject === '1 hearing today: 10:30 AM')!;
    expect(summary.to).toBe(lawyer.email);
    expect(summary.text).toContain('10:30 AM - Gupta vs. Mehta Builders (RCS/412/2026)');
  });

  it('is idempotent: overlapping runs, later runs and a changed time send it only once', async () => {
    const { lawyer } = await caseWithHearing();
    const serverA = deps({ delayMs: 25 });
    const serverB = deps({ delayMs: 25 });
    const at7 = istDateTimeToUtc(hearingDay, '07:01');

    await Promise.all([
      runReminderCycle(serverA.jobDeps, at7),
      runReminderCycle(serverB.jobDeps, at7),
      runReminderCycle(serverA.jobDeps, at7),
    ]);
    await runReminderCycle(serverA.jobDeps, new Date(at7.getTime() + 5 * MIN));
    // Moving the summary time later the same day does not produce a second one.
    await prisma.lawyer.update({ where: { id: lawyer.id }, data: { dailySummaryTime: '09:00' } });
    await runReminderCycle(serverB.jobDeps, istDateTimeToUtc(hearingDay, '09:01'));

    const summaries = [...serverA.emails, ...serverB.emails].filter((e) =>
      e.subject.includes('hearing today'),
    );
    expect(summaries).toHaveLength(1);
    expect(await prisma.reminder.count({ where: { type: 'DAILY_SUMMARY' } })).toBe(1);
    expect(await prisma.reminder.count({ where: { type: 'DAILY_SUMMARY', status: 'SENT' } })).toBe(
      1,
    );
  });

  it('is not created on a day without hearings', async () => {
    await caseWithHearing();
    const { jobDeps } = deps();
    const dayBefore = istDateString(new Date(hearingAt.getTime() - DAY));
    const result = await runReminderCycle(jobDeps, istDateTimeToUtc(dayBefore, '07:01'));
    expect(result.summariesCreated).toBe(0);
  });

  it('respects the lawyer turning it off and the chosen time', async () => {
    const { lawyer } = await caseWithHearing();
    const { jobDeps } = deps();

    await prisma.lawyer.update({ where: { id: lawyer.id }, data: { dailySummaryTime: '08:30' } });
    expect(
      (await runReminderCycle(jobDeps, istDateTimeToUtc(hearingDay, '08:00'))).summariesCreated,
    ).toBe(0);

    await prisma.lawyer.update({ where: { id: lawyer.id }, data: { dailySummaryEnabled: false } });
    expect(
      (await runReminderCycle(jobDeps, istDateTimeToUtc(hearingDay, '09:00'))).summariesCreated,
    ).toBe(0);
  });
});

describe('missing next-date nudge', () => {
  const nudges = (emails: MailMessage[]) =>
    emails.filter((e) => e.subject.startsWith('Log the outcome'));

  it('is sent at 6:00 PM IST on the hearing day, once only', async () => {
    const { hearingId } = await caseWithHearing();
    const serverA = deps();
    const serverB = deps();

    await runReminderCycle(serverA.jobDeps, istDateTimeToUtc(hearingDay, '17:59'));
    expect(nudges(serverA.emails)).toHaveLength(0);

    const at6 = istDateTimeToUtc(hearingDay, '18:00');
    await Promise.all([
      runReminderCycle(serverA.jobDeps, at6),
      runReminderCycle(serverB.jobDeps, at6),
    ]);
    await runReminderCycle(serverA.jobDeps, new Date(at6.getTime() + 5 * MIN));
    await runReminderCycle(serverB.jobDeps, new Date(at6.getTime() + 3 * HOUR));

    expect(nudges([...serverA.emails, ...serverB.emails])).toHaveLength(1);
    expect(
      await prisma.reminder.count({
        where: { hearingId, type: 'MISSING_OUTCOME', status: 'SENT' },
      }),
    ).toBe(1);
  });

  it('is not sent once the outcome has been logged', async () => {
    const { hearingId } = await caseWithHearing();
    const { jobDeps, emails } = deps();
    // Outcome recorded on the day (written directly: the API only accepts outcomes on or
    // after the real hearing day, which in this test is 10 days away).
    await prisma.hearing.update({
      where: { id: hearingId },
      data: { status: 'COMPLETED', outcome: 'ADJOURNED', loggedAt: new Date() },
    });

    await runReminderCycle(jobDeps, istDateTimeToUtc(hearingDay, '18:01'));

    expect(nudges(emails)).toHaveLength(0);
    const nudge = await prisma.reminder.findFirstOrThrow({
      where: { hearingId, type: 'MISSING_OUTCOME' },
    });
    expect(nudge).toMatchObject({
      status: 'CANCELLED',
      lastError: 'The outcome of the hearing has been logged.',
    });
  });
});
