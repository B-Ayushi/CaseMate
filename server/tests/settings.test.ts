import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createUnconfiguredSmsProvider } from '../src/lib/sms.js';
import { addDaysToIsoDay, formatIst, istDateString } from '../src/lib/time.js';
import { buildTestApp, resetDatabase, signUpLawyer, testConfig } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'testpass123'; // the password signUpLawyer uses
const D = istDateString(new Date(Date.now() + 10 * DAY));

const sessionCookie = (res: request.Response) =>
  ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('casemate_session='))
    ?.split(';')[0];

async function lawyer(app: Express, overrides: Record<string, unknown> = {}) {
  const { cookie, lawyer } = await signUpLawyer(app, overrides);
  const as = (r: request.Test) => r.set('Cookie', cookie);
  const client = (
    await as(request(app).post('/api/clients')).send({ name: 'Ramesh Gupta', phone: '9822011223' })
  ).body.client as { id: string };

  let counter = 0;
  async function addCase(overridesForCase: Record<string, unknown> = {}, date = D, time = '10:30') {
    counter += 1;
    const res = await as(request(app).post('/api/cases')).send({
      clientId: client.id,
      title: `Case ${counter}`,
      caseNumber: `RCS/${counter}/2026`,
      courtName: 'Civil Court, Pune',
      firstHearing: { date, time },
      ...overridesForCase,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const hearing = await prisma.hearing.findFirstOrThrow({ where: { caseId: res.body.case.id } });
    return { caseId: res.body.case.id as string, hearingId: hearing.id };
  }

  return { app, cookie, as, lawyer, client, addCase };
}

// PENDING reminders of a hearing, as "TYPE/CHANNEL".
async function pending(hearingId: string) {
  const rows = await prisma.reminder.findMany({ where: { hearingId, status: 'PENDING' } });
  return rows.map((r) => `${r.type}/${r.channel}`).sort();
}

// No two reminder rows for the same hearing, type, channel and time.
async function expectNoDuplicates() {
  const rows = await prisma.reminder.findMany({ where: { hearingId: { not: null } } });
  const keys = rows.map((r) => `${r.hearingId}|${r.type}|${r.channel}|${r.sendAt.toISOString()}`);
  expect(new Set(keys).size).toBe(keys.length);
}

const ALL = ['DAY_BEFORE/EMAIL', 'DAY_BEFORE/SMS', 'MISSING_OUTCOME/EMAIL', 'TWO_HOUR/SMS'];

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('profile', () => {
  it('reads and updates name, phone and Bar Council number; email stays read-only', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);

    const before = await a.as(request(app).get('/api/settings/profile'));
    expect(before.status).toBe(200);
    expect(before.body.profile).toMatchObject({ email: a.lawyer.email, phone: '+919876543210' });
    expect(before.body.profile).not.toHaveProperty('passwordHash');

    const res = await a.as(request(app).patch('/api/settings/profile')).send({
      name: '  Adv. Priya Sharma ',
      phone: '098220-12345',
      barCouncilNumber: 'MAH/99/2010',
      email: 'someone-else@example.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({
      id: a.lawyer.id,
      name: 'Adv. Priya Sharma',
      email: a.lawyer.email,
      phone: '+919822012345',
      barCouncilNumber: 'MAH/99/2010',
    });
  });

  it.each([
    ['+91 98220 12345', '+919822012345'],
    ['919822012345', '+919822012345'],
    ['9822012345', '+919822012345'],
  ])('normalises the phone %s to %s, the number SMS reminders go to', async (input, stored) => {
    const { app, sentSms } = buildTestApp();
    const a = await lawyer(app);
    await a.as(request(app).patch('/api/settings/profile')).send({ phone: input }).expect(200);
    expect((await prisma.lawyer.findUniqueOrThrow({ where: { id: a.lawyer.id } })).phone).toBe(
      stored,
    );

    await a.as(request(app).post('/api/settings/test-reminder')).expect(200);
    expect(sentSms.map((s) => s.to)).toEqual([stored]);
  });

  it('rejects an invalid phone, an empty name and an empty update', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    const bad = await a.as(request(app).patch('/api/settings/profile')).send({
      phone: '12345',
      name: ' ',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.fields).toMatchObject({
      phone: 'Enter a valid Indian mobile number, for example 98765 43210',
      name: 'Enter your name',
    });
    expect((await a.as(request(app).patch('/api/settings/profile')).send({})).status).toBe(400);
  });
});

describe('changing the password', () => {
  it('keeps this session, logs out every other session, and the new password works', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    // A second session, as if logged in on another device.
    const other = sessionCookie(
      await request(app)
        .post('/api/auth/login')
        .send({ email: a.lawyer.email, password: PASSWORD }),
    )!;
    expect((await request(app).get('/api/auth/me').set('Cookie', other)).status).toBe(200);

    const res = await a
      .as(request(app).post('/api/settings/password'))
      .send({ currentPassword: PASSWORD, newPassword: 'newpass456' });
    expect(res.status).toBe(200);
    const renewed = sessionCookie(res)!;
    expect(renewed).toBeDefined();

    // This browser carries on with its renewed session.
    expect((await request(app).get('/api/auth/me').set('Cookie', renewed)).status).toBe(200);
    expect((await request(app).get('/api/dashboard').set('Cookie', renewed)).status).toBe(200);
    // The other device is logged out, and told to clear its cookie.
    const ended = await request(app).get('/api/dashboard').set('Cookie', other);
    expect(ended.status).toBe(401);
    expect(String(ended.headers['set-cookie'])).toMatch(/casemate_session=;/);
    // So is any copy of the old cookie.
    expect((await request(app).get('/api/auth/me').set('Cookie', a.cookie)).status).toBe(401);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: a.lawyer.email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: a.lawyer.email, password: 'newpass456' });
    expect(newLogin.status).toBe(200);
  });

  it('needs the right current password and a new one that follows the signup rules', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    const send = (body: object) => a.as(request(app).post('/api/settings/password')).send(body);

    const wrong = await send({ currentPassword: 'nottheone1', newPassword: 'newpass456' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.fields).toEqual({ currentPassword: 'This is not your current password' });

    const weak = await send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.fields.newPassword).toBe('Password must be at least 8 characters');

    const same = await send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.fields.newPassword).toMatch(/different/);

    // Nothing changed: the original session still works.
    expect((await a.as(request(app).get('/api/auth/me'))).status).toBe(200);
  });
});

describe('reminder preferences', () => {
  it('reads the preferences and validates the summary time in 15-minute steps', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    const prefs = await a.as(request(app).get('/api/settings/reminders'));
    expect(prefs.body.preferences).toEqual({
      emailEnabled: true,
      smsEnabled: true,
      dayBeforeEnabled: true,
      twoHourEnabled: true,
      dailySummaryEnabled: true,
      dailySummaryTime: '07:00',
      missingOutcomeNudgeEnabled: true,
    });

    const odd = await a
      .as(request(app).patch('/api/settings/reminders'))
      .send({ dailySummaryTime: '07:10' });
    expect(odd.status).toBe(400);
    expect(odd.body.fields.dailySummaryTime).toMatch(/quarter hour/);
    const notBool = await a
      .as(request(app).patch('/api/settings/reminders'))
      .send({ smsEnabled: 'no' });
    expect(notBool.status).toBe(400);

    const ok = await a
      .as(request(app).patch('/api/settings/reminders'))
      .send({ dailySummaryTime: '06:45' });
    expect(ok.status).toBe(200);
    expect(ok.body.preferences).toMatchObject({ dailySummaryTime: '06:45', smsEnabled: true });
  });

  it('turning SMS off cancels pending SMS; on again restores them with no duplicates', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    const b = await lawyer(app);
    const one = await a.addCase();
    const two = await a.addCase({}, addDaysToIsoDay(D, 3), '15:00');
    const bCase = await b.addCase();
    const rowsBefore = await prisma.reminder.count();

    const off = await a
      .as(request(app).patch('/api/settings/reminders'))
      .send({ smsEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body.upcomingHearings).toBe(2);
    for (const { hearingId } of [one, two]) {
      expect(await pending(hearingId)).toEqual(['DAY_BEFORE/EMAIL', 'MISSING_OUTCOME/EMAIL']);
    }
    // Another lawyer's reminders are untouched.
    expect(await pending(bCase.hearingId)).toEqual(ALL);

    const on = await a.as(request(app).patch('/api/settings/reminders')).send({ smsEnabled: true });
    expect(on.body.upcomingHearings).toBe(2);
    for (const { hearingId } of [one, two]) expect(await pending(hearingId)).toEqual(ALL);
    // Cancelled rows were brought back, not copied.
    expect(await prisma.reminder.count()).toBe(rowsBefore);
    await expectNoDuplicates();
  });

  it('turns each reminder type off and on', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    const { hearingId } = await a.addCase();
    const patch = (body: object) =>
      a.as(request(app).patch('/api/settings/reminders')).send(body).expect(200);

    await patch({ dayBeforeEnabled: false });
    expect(await pending(hearingId)).toEqual(['MISSING_OUTCOME/EMAIL', 'TWO_HOUR/SMS']);
    await patch({ twoHourEnabled: false, missingOutcomeNudgeEnabled: false });
    expect(await pending(hearingId)).toEqual([]);
    await patch({ dayBeforeEnabled: true, twoHourEnabled: true, missingOutcomeNudgeEnabled: true });
    expect(await pending(hearingId)).toEqual(ALL);

    await patch({ emailEnabled: false });
    expect(await pending(hearingId)).toEqual(['DAY_BEFORE/SMS', 'TWO_HOUR/SMS']);
    await patch({ emailEnabled: true });
    expect(await pending(hearingId)).toEqual(ALL);
    await expectNoDuplicates();
  });

  it("respects each case's own overrides", async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    const smsAlways = await a.addCase({ smsReminderOverride: true });
    const smsDefault = await a.addCase();
    const noEmail = await a.addCase({ emailReminderOverride: false });

    await a
      .as(request(app).patch('/api/settings/reminders'))
      .send({ smsEnabled: false })
      .expect(200);

    expect(await pending(smsAlways.hearingId)).toEqual(ALL);
    expect(await pending(smsDefault.hearingId)).toEqual([
      'DAY_BEFORE/EMAIL',
      'MISSING_OUTCOME/EMAIL',
    ]);
    // Email off for this case, SMS off by default: nothing at all.
    expect(await pending(noEmail.hearingId)).toEqual([]);

    await a
      .as(request(app).patch('/api/settings/reminders'))
      .send({ smsEnabled: true })
      .expect(200);
    expect(await pending(noEmail.hearingId)).toEqual(['DAY_BEFORE/SMS', 'TWO_HOUR/SMS']);
    await expectNoDuplicates();
  });

  it('never changes SENT or FAILED reminders', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    const { hearingId } = await a.addCase();
    const sent = await prisma.reminder.findFirstOrThrow({
      where: { hearingId, type: 'DAY_BEFORE', channel: 'EMAIL' },
    });
    const failed = await prisma.reminder.findFirstOrThrow({
      where: { hearingId, type: 'DAY_BEFORE', channel: 'SMS' },
    });
    await prisma.reminder.update({
      where: { id: sent.id },
      data: { status: 'SENT', sentAt: new Date(), attempts: 1 },
    });
    await prisma.reminder.update({
      where: { id: failed.id },
      data: { status: 'FAILED', attempts: 4, lastError: 'Connection timeout' },
    });
    const snapshot = await prisma.reminder.findMany({
      where: { id: { in: [sent.id, failed.id] } },
      orderBy: { id: 'asc' },
    });

    for (const body of [
      { emailEnabled: false, smsEnabled: false, dayBeforeEnabled: false },
      { emailEnabled: true, smsEnabled: true, dayBeforeEnabled: true },
    ]) {
      await a.as(request(app).patch('/api/settings/reminders')).send(body).expect(200);
    }

    expect(
      await prisma.reminder.findMany({
        where: { id: { in: [sent.id, failed.id] } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(snapshot);
    // And no second day-before reminder was created beside them.
    expect(await prisma.reminder.count({ where: { hearingId, type: 'DAY_BEFORE' } })).toBe(2);
    expect(await pending(hearingId)).toEqual(['MISSING_OUTCOME/EMAIL', 'TWO_HOUR/SMS']);
  });

  it('turning a type back on skips send times already in the past', async () => {
    const { app } = buildTestApp();
    const a = await lawyer(app);
    const { hearingId } = await a.addCase();
    // Move the hearing to 3 hours from now: its day-before time has already passed.
    const soon = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await a
      .as(request(app).put(`/api/hearings/${hearingId}`))
      .send({
        date: istDateString(soon),
        time: formatIst(soon, 'HH:mm'),
        purpose: null,
        notes: null,
      })
      .expect(200);
    expect(await pending(hearingId)).toEqual(['MISSING_OUTCOME/EMAIL', 'TWO_HOUR/SMS']);

    const patch = (body: object) =>
      a.as(request(app).patch('/api/settings/reminders')).send(body).expect(200);
    await patch({ dayBeforeEnabled: false, twoHourEnabled: false });
    expect(await pending(hearingId)).toEqual(['MISSING_OUTCOME/EMAIL']);
    await patch({ dayBeforeEnabled: true, twoHourEnabled: true });

    // The 2-hour SMS is still ahead and comes back; the day-before ones are in the past.
    expect(await pending(hearingId)).toEqual(['MISSING_OUTCOME/EMAIL', 'TWO_HOUR/SMS']);
    await expectNoDuplicates();
  });
});

describe('test reminder', () => {
  it('sends one email and one SMS to the lawyer and reports each', async () => {
    const { app, sentEmails, sentSms } = buildTestApp();
    const a = await lawyer(app, { phone: '9822012345' });

    const res = await a.as(request(app).post('/api/settings/test-reminder'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: { status: 'sent', to: a.lawyer.email },
      sms: { status: 'sent', to: '+919822012345' },
    });
    expect(sentEmails.map((e) => [e.to, e.subject])).toEqual([
      [a.lawyer.email, 'CaseMate test reminder'],
    ]);
    expect(sentSms).toEqual([{ to: '+919822012345', body: expect.stringMatching(/^CaseMate: /) }]);
  });

  it('reports a failure on each channel separately, in plain English', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = createApp({
        prisma,
        config: testConfig,
        mailer: {
          async send() {
            throw new Error('self-signed certificate in certificate chain');
          },
        },
        sms: createUnconfiguredSmsProvider(),
      });
      const a = await lawyer(app);
      const res = await a.as(request(app).post('/api/settings/test-reminder'));
      expect(res.status).toBe(200);
      expect(res.body.email).toEqual({
        status: 'failed',
        to: a.lawyer.email,
        reason: 'Email could not be sent: the secure connection to the mail server failed',
      });
      expect(res.body.sms).toEqual({
        status: 'failed',
        to: '+919876543210',
        reason: 'SMS could not be sent: sending is not set up yet (see server settings)',
      });
    } finally {
      log.mockRestore();
    }
  });

  it('allows 5 test reminders an hour per lawyer', async () => {
    const { app, sentEmails } = buildTestApp();
    const a = await lawyer(app);
    const b = await lawyer(app);
    for (let i = 0; i < 5; i++) {
      await a.as(request(app).post('/api/settings/test-reminder')).expect(200);
    }
    const sixth = await a.as(request(app).post('/api/settings/test-reminder'));
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe('You can send 5 test reminders an hour. Please try again later.');
    expect(sentEmails).toHaveLength(5);
    // Another lawyer has their own allowance.
    await b.as(request(app).post('/api/settings/test-reminder')).expect(200);
  });
});

// A lawyer with one of everything, including billing rows that block a careless delete.
async function lawyerWithData(app: Express) {
  const l = await lawyer(app);
  await l
    .as(request(app).post(`/api/clients/${l.client.id}/notes`))
    .send({ text: 'Called about the sale deed' })
    .expect(201);
  const { caseId, hearingId } = await l.addCase();
  const invoice = await prisma.invoice.create({
    data: {
      lawyerId: l.lawyer.id,
      clientId: l.client.id,
      number: 'INV-001',
      issueDate: new Date(`${D}T00:00:00Z`),
      dueDate: new Date(`${D}T00:00:00Z`),
      totalPaise: 300000,
    },
  });
  await prisma.timeEntry.create({
    data: {
      lawyerId: l.lawyer.id,
      caseId,
      hearingId,
      workDate: new Date(`${D}T00:00:00Z`),
      minutes: 60,
      description: 'Drafting',
      ratePaise: 300000,
      amountPaise: 300000,
      invoiceId: invoice.id,
    },
  });
  await prisma.reminder.create({
    data: {
      lawyerId: l.lawyer.id,
      type: 'DAILY_SUMMARY',
      channel: 'EMAIL',
      summaryDate: new Date(`${D}T00:00:00Z`),
      sendAt: new Date(),
    },
  });
  return { ...l, caseId, hearingId };
}

const counts = async (lawyerId: string) => ({
  lawyers: await prisma.lawyer.count({ where: { id: lawyerId } }),
  clients: await prisma.client.count({ where: { lawyerId } }),
  clientNotes: await prisma.clientNote.count({ where: { lawyerId } }),
  cases: await prisma.case.count({ where: { lawyerId } }),
  hearings: await prisma.hearing.count({ where: { lawyerId } }),
  reminders: await prisma.reminder.count({ where: { lawyerId } }),
  timeEntries: await prisma.timeEntry.count({ where: { lawyerId } }),
  invoices: await prisma.invoice.count({ where: { lawyerId } }),
});

describe('your data', () => {
  it('exports everything the lawyer owns, and nothing of anyone else or any secret', async () => {
    const { app } = buildTestApp();
    const a = await lawyerWithData(app);
    const b = await lawyerWithData(app);

    const res = await a.as(request(app).get('/api/settings/export'));

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="casemate-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const data = JSON.parse(res.text);
    expect(data.profile).toMatchObject({ id: a.lawyer.id, email: a.lawyer.email });
    for (const key of [
      'clients',
      'clientNotes',
      'cases',
      'hearings',
      'reminders',
      'timeEntries',
      'invoices',
    ]) {
      expect(data[key].length, key).toBeGreaterThan(0);
      const owners = new Set(data[key].map((row: { lawyerId: string }) => row.lawyerId));
      expect([...owners], key).toEqual([a.lawyer.id]);
    }
    expect(data.reminders).toHaveLength(
      await prisma.reminder.count({ where: { lawyerId: a.lawyer.id } }),
    );
    expect(res.text).not.toContain(b.lawyer.id);
    expect(res.text).not.toMatch(/passwordHash|passwordResetTokenHash|\$2[aby]\$/);
  });

  it('deletes the account only with the right email and password', async () => {
    const { app } = buildTestApp();
    const a = await lawyerWithData(app);
    const before = await counts(a.lawyer.id);

    const wrongEmail = await a
      .as(request(app).delete('/api/settings/account'))
      .send({ email: 'someone@example.com', password: PASSWORD });
    expect(wrongEmail.status).toBe(400);
    expect(wrongEmail.body.fields).toEqual({ email: 'Type the email address you log in with' });

    const wrongPassword = await a
      .as(request(app).delete('/api/settings/account'))
      .send({ email: a.lawyer.email, password: 'nottheone1' });
    expect(wrongPassword.status).toBe(400);
    expect(wrongPassword.body.fields).toEqual({ password: 'This is not your current password' });

    expect(await counts(a.lawyer.id)).toEqual(before);
  });

  it("deletes the lawyer and all their data, logs them out, and leaves others' data alone", async () => {
    const { app } = buildTestApp();
    const a = await lawyerWithData(app);
    const b = await lawyerWithData(app);
    const bBefore = await counts(b.lawyer.id);
    expect(Object.values(await counts(a.lawyer.id)).every((n) => n > 0)).toBe(true);

    const res = await a
      .as(request(app).delete('/api/settings/account'))
      .send({ email: `  ${a.lawyer.email.toUpperCase()} `, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/casemate_session=;/);
    expect(await counts(a.lawyer.id)).toEqual({
      lawyers: 0,
      clients: 0,
      clientNotes: 0,
      cases: 0,
      hearings: 0,
      reminders: 0,
      timeEntries: 0,
      invoices: 0,
    });
    expect(await counts(b.lawyer.id)).toEqual(bBefore);
    // The old session no longer works.
    expect((await a.as(request(app).get('/api/auth/me'))).status).toBe(401);
    expect((await b.as(request(app).get('/api/auth/me'))).status).toBe(200);
  });
});

describe('access', () => {
  it('every settings route needs a login', async () => {
    const { app } = buildTestApp();
    const routes: [string, string][] = [
      ['get', '/api/settings/profile'],
      ['patch', '/api/settings/profile'],
      ['post', '/api/settings/password'],
      ['get', '/api/settings/reminders'],
      ['patch', '/api/settings/reminders'],
      ['post', '/api/settings/test-reminder'],
      ['get', '/api/settings/export'],
      ['delete', '/api/settings/account'],
    ];
    for (const [method, path] of routes) {
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
        method
      ]!(path);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
