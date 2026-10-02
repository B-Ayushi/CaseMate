import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { addDaysToIsoDay, istDateString, istDateTimeToUtc } from '../src/lib/time.js';
import { getDashboard } from '../src/services/dashboardService.js';
import { describeFailure } from '../src/services/reminderFailures.js';
import { retryReminder } from '../src/services/reminderService.js';
import { buildTestApp, resetDatabase, signUpLawyer } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

// An IST day far enough ahead that every hearing below can be created through the API
// (which only accepts future dates), whatever time the tests run.
const D = istDateString(new Date(Date.now() + 10 * DAY));
const day = (offset: number) => addDaysToIsoDay(D, offset);

async function setup() {
  const { app } = buildTestApp();
  const { cookie, lawyer } = await signUpLawyer(app);
  const as = (r: request.Test) => r.set('Cookie', cookie);
  const client = (
    await as(request(app).post('/api/clients')).send({ name: 'Ramesh Gupta', phone: '9822011223' })
  ).body.client as { id: string };

  let counter = 0;
  // Creates a case whose first hearing is at an IST date and time; returns its ids.
  async function caseAt(date: string, time: string, title?: string) {
    counter += 1;
    title ??= `Case ${counter}`;
    const res = await as(request(app).post('/api/cases')).send({
      clientId: client.id,
      title,
      caseNumber: `RCS/${counter}/2026`,
      courtName: 'Civil Court, Pune',
      courtroom: 'Room 4',
      firstHearing: { date, time, purpose: 'Evidence' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const hearing = await prisma.hearing.findFirstOrThrow({ where: { caseId: res.body.case.id } });
    return { caseId: res.body.case.id as string, hearingId: hearing.id };
  }

  return { app, as, lawyer, cookie, caseAt };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('dashboard: IST days', () => {
  it('counts a hearing at 11:30 PM IST as today and 12:15 AM IST as tomorrow', async () => {
    const { lawyer, caseAt } = await setup();
    await caseAt(day(-1), '23:59', 'Late yesterday');
    await caseAt(D, '23:30', 'Late tonight');
    await caseAt(day(1), '00:15', 'Just after midnight');

    // 9:00 AM IST on day D. 11:30 PM IST is 6:00 PM UTC, the same UTC day, but
    // 12:15 AM IST tomorrow is still today in UTC: only IST boundaries get this right.
    const dashboard = await getDashboard(prisma, lawyer.id, istDateTimeToUtc(D, '09:00'));

    expect(dashboard.today).toBe(D);
    expect(dashboard.todayHearings.map((h) => h.case.title)).toEqual(['Late tonight']);
    expect(dashboard.counts.today).toBe(1);
    expect(dashboard.next7Days.days[0]).toEqual({ date: day(1), count: 1 });
    // Yesterday's hearing has passed with no outcome logged.
    expect(dashboard.needsAttention.missingOutcome.map((h) => h.case.title)).toEqual([
      'Late yesterday',
    ]);
    expect(dashboard.todayHearings[0]!.scheduledAt).toEqual(istDateTimeToUtc(D, '23:30'));
  });

  it('breaks the next 7 days down per day, from tomorrow to a week ahead', async () => {
    const { lawyer, as, app, caseAt } = await setup();
    await caseAt(D, '10:00'); // today: not in the next 7 days
    await caseAt(day(1), '10:00');
    await caseAt(day(1), '15:00');
    await caseAt(day(3), '11:00');
    await caseAt(day(7), '23:45'); // the last day of the window
    await caseAt(day(8), '00:05'); // just outside it
    const cancelled = await caseAt(day(2), '10:00');
    await as(request(app).post(`/api/hearings/${cancelled.hearingId}/cancel`)).expect(200);
    const closed = await caseAt(day(4), '10:00');
    await prisma.case.update({ where: { id: closed.caseId }, data: { status: 'CLOSED' } });

    const dashboard = await getDashboard(prisma, lawyer.id, istDateTimeToUtc(D, '08:00'));

    expect(dashboard.next7Days.days).toEqual([
      { date: day(1), count: 2 },
      { date: day(2), count: 0 },
      { date: day(3), count: 1 },
      { date: day(4), count: 0 },
      { date: day(5), count: 0 },
      { date: day(6), count: 0 },
      { date: day(7), count: 1 },
    ]);
    expect(dashboard.next7Days.total).toBe(4);
    expect(dashboard.counts).toMatchObject({ today: 1, next7Days: 4, needNextDate: 0 });
  });
});

describe('dashboard: needs attention', () => {
  it('lists hearings that passed without an outcome, and recent failed reminders', async () => {
    const { app, as, caseAt } = await setup();
    const past = await caseAt(day(0), '10:30', 'Needs a next date');
    const logged = await caseAt(day(0), '11:00', 'Outcome logged');
    const closed = await caseAt(day(0), '11:30', 'Closed case');
    await caseAt(day(0), '12:00', 'Still ahead');
    // Move three of them into the past (only possible in the database).
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.hearing.updateMany({
      where: { id: { in: [past.hearingId, logged.hearingId, closed.hearingId] } },
      data: { scheduledAt: hourAgo },
    });
    await prisma.hearing.update({
      where: { id: logged.hearingId },
      data: { status: 'COMPLETED', outcome: 'HEARD', loggedAt: new Date() },
    });
    await prisma.case.update({ where: { id: closed.caseId }, data: { status: 'CLOSED' } });

    const ahead = await prisma.hearing.findFirstOrThrow({
      where: { case: { title: 'Still ahead' } },
      include: { reminders: true },
    });
    const email = ahead.reminders.find((r) => r.type === 'DAY_BEFORE' && r.channel === 'EMAIL')!;
    const sms = ahead.reminders.find((r) => r.type === 'DAY_BEFORE' && r.channel === 'SMS')!;
    const twoHour = ahead.reminders.find((r) => r.type === 'TWO_HOUR')!;
    await prisma.reminder.update({
      where: { id: email.id },
      data: { status: 'FAILED', attempts: 4, lastError: 'Connection timeout' },
    });
    await prisma.reminder.update({
      where: { id: sms.id },
      data: {
        status: 'FAILED',
        attempts: 4,
        lastError: 'SMS is not configured: set TWILIO_ACCOUNT_SID, ...',
      },
    });
    // Failed more than a week ago: no longer shown.
    await prisma.reminder.update({
      where: { id: twoHour.id },
      data: { status: 'FAILED', attempts: 4, lastError: 'Connection timeout' },
    });
    await prisma.$executeRaw`UPDATE reminders SET updatedAt = ${new Date(Date.now() - 8 * DAY)} WHERE id = ${twoHour.id}`;

    const res = await as(request(app).get('/api/dashboard'));
    expect(res.status).toBe(200);
    const { needsAttention, counts } = res.body;

    expect(
      needsAttention.missingOutcome.map((h: { case: { title: string } }) => h.case.title),
    ).toEqual(['Needs a next date']);
    expect(needsAttention.missingOutcome[0]).toMatchObject({
      id: past.hearingId,
      case: { id: past.caseId },
    });
    expect(counts.needNextDate).toBe(1);

    const failed = needsAttention.failedReminders;
    expect(failed.map((r: { id: string }) => r.id).sort()).toEqual([email.id, sms.id].sort());
    expect(failed.find((r: { id: string }) => r.id === email.id)).toMatchObject({
      channel: 'EMAIL',
      type: 'DAY_BEFORE',
      reason: 'Email could not be sent: mail server connection failed',
      detail: 'Connection timeout',
      case: { title: 'Still ahead' },
    });
    expect(failed.find((r: { id: string }) => r.id === sms.id).reason).toBe(
      'SMS could not be sent: sending is not set up yet (see server settings)',
    );
  });

  it('turns technical errors into short plain-English reasons', () => {
    expect(describeFailure('EMAIL', 'self-signed certificate in certificate chain')).toBe(
      'Email could not be sent: the secure connection to the mail server failed',
    );
    expect(
      describeFailure('EMAIL', 'Invalid login: 535-5.7.8 Username and Password not accepted'),
    ).toBe('Email could not be sent: the mail server rejected the login');
    expect(describeFailure('EMAIL', 'connect ECONNREFUSED 127.0.0.1:587')).toBe(
      'Email could not be sent: mail server connection failed',
    );
    expect(
      describeFailure(
        'SMS',
        'The number +919822012345 is unverified. Trial accounts cannot send messages to unverified numbers',
      ),
    ).toBe('SMS could not be sent: your number is not verified on the SMS trial account');
    expect(
      describeFailure('SMS', '"12" is not a valid Indian mobile number, so no SMS could be sent.'),
    ).toBe('SMS could not be sent: your mobile number is not valid');
    expect(describeFailure('SMS', 'Sending was interrupted (the server stopped).')).toBe(
      'SMS could not be sent: sending was interrupted when the server stopped',
    );
    expect(describeFailure('EMAIL', 'Something odd')).toBe(
      'Email could not be sent: the mail server returned an error',
    );
  });
});

describe('retrying a failed reminder', () => {
  async function failedReminderFor(hearingId: string, type = 'DAY_BEFORE', channel = 'EMAIL') {
    const reminder = await prisma.reminder.findFirstOrThrow({
      where: {
        hearingId,
        type: type as 'DAY_BEFORE',
        channel: channel as 'EMAIL',
        status: 'PENDING',
      },
    });
    return prisma.reminder.update({
      where: { id: reminder.id },
      data: { status: 'FAILED', attempts: 4, lastError: 'Connection timeout' },
    });
  }

  const retry = (app: Express, cookie: string, id: string) =>
    request(app).post(`/api/reminders/${id}/retry`).set('Cookie', cookie);

  it('puts a failed reminder for a future hearing back in the queue, once', async () => {
    const { app, cookie, as, caseAt } = await setup();
    const { hearingId } = await caseAt(day(0), '10:30');
    const failed = await failedReminderFor(hearingId);

    const dashboard = (await as(request(app).get('/api/dashboard'))).body;
    expect(dashboard.needsAttention.failedReminders[0]).toMatchObject({
      id: failed.id,
      canRetry: true,
      retryBlockedReason: null,
    });

    const res = await retry(app, cookie, failed.id);
    expect(res.status).toBe(200);
    expect(res.body.reminder).toMatchObject({ id: failed.id, status: 'PENDING', attempts: 0 });
    const stored = await prisma.reminder.findUniqueOrThrow({ where: { id: failed.id } });
    expect(stored).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });

    const again = await retry(app, cookie, failed.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('Only a reminder that failed can be retried.');
  });

  it('refuses with a clear message when the hearing has an outcome or has moved', async () => {
    const { app, cookie, as, caseAt } = await setup();

    const done = await caseAt(day(0), '11:00');
    const doneReminder = await failedReminderFor(done.hearingId);
    await prisma.hearing.update({
      where: { id: done.hearingId },
      data: { status: 'COMPLETED', outcome: 'HEARD' },
    });
    const outcome = await retry(app, cookie, doneReminder.id);
    expect(outcome.status).toBe(409);
    expect(outcome.body.error).toBe(
      "This reminder can't be sent again. The outcome of the hearing has been logged.",
    );

    const moved = await caseAt(day(0), '12:00');
    const movedReminder = await failedReminderFor(moved.hearingId);
    await as(request(app).put(`/api/hearings/${moved.hearingId}`))
      .send({ date: day(2), time: '12:00', purpose: null, notes: null })
      .expect(200);
    const movedRes = await retry(app, cookie, movedReminder.id);
    expect(movedRes.status).toBe(409);
    expect(movedRes.body.error).toMatch(/The hearing was moved to .* 12:00 PM IST\.$/);

    // Nothing was put back in the queue.
    expect(
      await prisma.reminder.count({
        where: { id: { in: [doneReminder.id, movedReminder.id] }, status: 'FAILED' },
      }),
    ).toBe(2);
    // The dashboard explains why each cannot be retried.
    const listed = (await as(request(app).get('/api/dashboard'))).body.needsAttention
      .failedReminders as { id: string; canRetry: boolean; retryBlockedReason: string }[];
    expect(listed.every((r) => !r.canRetry && r.retryBlockedReason)).toBe(true);
  });

  it('refuses a hearing that has already taken place', async () => {
    const { lawyer, caseAt } = await setup();
    const { hearingId } = await caseAt(day(0), '10:30');
    const failed = await failedReminderFor(hearingId);

    // Ten minutes after the hearing, the same reminder can no longer be retried.
    await expect(
      retryReminder(prisma, lawyer.id, failed.id, istDateTimeToUtc(D, '10:40')),
    ).rejects.toThrow("This reminder can't be sent again. The hearing has already taken place.");
    await expect(
      retryReminder(prisma, lawyer.id, failed.id, istDateTimeToUtc(D, '10:20')),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('retries a daily summary only on its own day while a hearing is still ahead', async () => {
    const { lawyer, caseAt } = await setup();
    await caseAt(D, '10:30');
    const summary = await prisma.reminder.create({
      data: {
        lawyerId: lawyer.id,
        type: 'DAILY_SUMMARY',
        channel: 'EMAIL',
        summaryDate: new Date(`${D}T00:00:00Z`),
        sendAt: istDateTimeToUtc(D, '07:00'),
        status: 'FAILED',
        attempts: 4,
        lastError: 'Connection timeout',
      },
    });

    await expect(
      retryReminder(prisma, lawyer.id, summary.id, istDateTimeToUtc(day(1), '08:00')),
    ).rejects.toThrow('This daily summary was for an earlier day.');
    await expect(
      retryReminder(prisma, lawyer.id, summary.id, istDateTimeToUtc(D, '11:00')),
    ).rejects.toThrow('No hearings are left today to summarise.');
    await expect(
      retryReminder(prisma, lawyer.id, summary.id, istDateTimeToUtc(D, '08:00')),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });
});

describe('calendar', () => {
  // A month two months ahead, so every hearing in it is in the future.
  const month = istDateString(new Date(Date.now() + 62 * DAY)).slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${month}-01`;
  const last = `${month}-${String(lastDay).padStart(2, '0')}`;

  it('returns the hearings of a month, with month boundaries in IST', async () => {
    const { app, as, caseAt } = await setup();
    await caseAt(addDaysToIsoDay(first, -1), '23:45', 'Previous month');
    // 12:30 AM IST on the 1st is still the previous month in UTC.
    await caseAt(first, '00:30', 'First of the month');
    await caseAt(last, '23:30', 'Last of the month');
    await caseAt(addDaysToIsoDay(last, 1), '00:15', 'Next month');

    const res = await as(request(app).get(`/api/calendar?month=${month}`));

    expect(res.status).toBe(200);
    expect(res.body.month).toBe(month);
    expect(res.body.hearings).toHaveLength(2);
    expect(res.body.hearings[0]).toMatchObject({
      date: first,
      time: '00:30',
      case: { title: 'First of the month', courtName: 'Civil Court, Pune', courtroom: 'Room 4' },
    });
    expect(res.body.hearings[0].case.id).toEqual(expect.any(String));
    expect(res.body.hearings[1]).toMatchObject({ date: last, time: '23:30' });
  });

  it('rejects a month that is missing or not YYYY-MM', async () => {
    const { app, as } = await setup();
    for (const query of ['', '?month=2026-13', '?month=2026-1', '?month=october']) {
      const res = await as(request(app).get(`/api/calendar${query}`));
      expect(res.status, query).toBe(400);
    }
  });
});

describe('ownership', () => {
  it("lawyer B never sees or retries lawyer A's data", async () => {
    const a = await setup();
    const { hearingId } = await a.caseAt(D, '10:30');
    const past = await a.caseAt(D, '11:00');
    await prisma.hearing.update({
      where: { id: past.hearingId },
      data: { scheduledAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const reminder = await prisma.reminder.findFirstOrThrow({ where: { hearingId } });
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { status: 'FAILED', lastError: 'Connection timeout' },
    });

    const { app } = buildTestApp();
    const b = await signUpLawyer(app);
    const asB = (r: request.Test) => r.set('Cookie', b.cookie);

    const dashboard = (await asB(request(app).get('/api/dashboard'))).body;
    expect(dashboard.hasCases).toBe(false);
    expect(dashboard.counts).toEqual({
      today: 0,
      next7Days: 0,
      needNextDate: 0,
      unpaidInvoices: 0,
      unpaidPaise: 0,
    });
    expect(dashboard.todayHearings).toEqual([]);
    expect(dashboard.needsAttention).toEqual({
      missingOutcome: [],
      failedReminders: [],
      overdueInvoices: [],
    });

    const calendar = (await asB(request(app).get(`/api/calendar?month=${D.slice(0, 7)}`))).body;
    expect(calendar.hearings).toEqual([]);

    const retry = await asB(request(app).post(`/api/reminders/${reminder.id}/retry`));
    expect(retry.status).toBe(404);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe(
      'FAILED',
    );

    // A's own view does show them.
    const own = (await a.as(request(app).get('/api/dashboard'))).body;
    expect(own.needsAttention.missingOutcome).toHaveLength(1);
    expect(own.needsAttention.failedReminders).toHaveLength(1);
  });

  it('needs a login and returns 404 for a reminder id that cannot exist', async () => {
    const { app, as } = await setup();
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
    expect((await request(app).get('/api/calendar?month=2026-10')).status).toBe(401);
    expect((await as(request(app).post('/api/reminders/not-an-id/retry'))).status).toBe(404);
  });
});
