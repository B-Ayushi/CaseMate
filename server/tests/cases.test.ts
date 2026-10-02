import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { istDateString } from '../src/lib/time.js';
import { planHearingReminders } from '../src/services/reminderPlanner.js';
import { buildTestApp, resetDatabase, signUpLawyer } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

// "yyyy-MM-dd" of the IST day `days` from now.
const istDay = (days: number) => istDateString(new Date(Date.now() + days * DAY));

async function setup() {
  const { app } = buildTestApp();
  const { cookie, lawyer } = await signUpLawyer(app);
  const client = (
    await request(app)
      .post('/api/clients')
      .set('Cookie', cookie)
      .send({ name: 'Ramesh Gupta', phone: '9822011223', hourlyRatePaise: 300000 })
  ).body.client;
  const as = (r: request.Test) => r.set('Cookie', cookie);
  return { app, cookie, lawyer, client, as };
}

function caseBody(clientId: string, overrides: Record<string, unknown> = {}) {
  return {
    clientId,
    title: 'Gupta vs. Mehta Builders',
    caseNumber: 'RCS/412/2026',
    caseType: 'Civil suit',
    courtName: 'Civil Court, Pune',
    courtroom: 'Room 4',
    judge: 'Hon. A. Kulkarni',
    opposingParty: 'Mehta Builders',
    notes: 'Bring the original sale agreement',
    firstHearing: { date: istDay(10), time: '10:30', purpose: 'Evidence' },
    ...overrides,
  };
}

async function remindersOf(hearingId: string) {
  return prisma.reminder.findMany({
    where: { hearingId },
    orderBy: [{ sendAt: 'asc' }, { channel: 'asc' }],
  });
}

const summary = (rows: { type: string; channel: string; status: string }[]) =>
  rows.map((r) => `${r.type}/${r.channel}/${r.status}`).sort();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('reminder planning', () => {
  const prefs = {
    emailEnabled: true,
    smsEnabled: true,
    dayBeforeEnabled: true,
    twoHourEnabled: true,
    missingOutcomeNudgeEnabled: true,
  };
  const active = {
    status: 'ACTIVE' as const,
    emailReminderOverride: null,
    smsReminderOverride: null,
    dayBeforeReminderOverride: null,
    twoHourReminderOverride: null,
  };

  it('times every reminder from an IST hearing', () => {
    // 14 Oct 2026, 10:30 AM IST = 05:00 UTC
    const plan = planHearingReminders(
      { scheduledAt: new Date('2026-10-14T05:00:00Z'), status: 'SCHEDULED' },
      active,
      prefs,
    );
    expect(plan.map((r) => `${r.type}/${r.channel}@${r.sendAt.toISOString()}`)).toEqual([
      'DAY_BEFORE/EMAIL@2026-10-13T05:00:00.000Z',
      'DAY_BEFORE/SMS@2026-10-13T05:00:00.000Z',
      'TWO_HOUR/SMS@2026-10-14T03:00:00.000Z',
      'MISSING_OUTCOME/EMAIL@2026-10-14T12:30:00.000Z', // 6:00 PM IST
    ]);
  });

  it('nudges an hour after a hearing that runs past 5 PM', () => {
    const plan = planHearingReminders(
      { scheduledAt: new Date('2026-10-14T12:30:00Z'), status: 'SCHEDULED' }, // 6 PM IST
      active,
      prefs,
    );
    expect(plan.find((r) => r.type === 'MISSING_OUTCOME')?.sendAt.toISOString()).toBe(
      '2026-10-14T13:30:00.000Z',
    );
  });

  it('lets a case override the lawyer, and plans nothing for a closed case', () => {
    const scheduled = {
      scheduledAt: new Date('2026-10-14T05:00:00Z'),
      status: 'SCHEDULED' as const,
    };
    const noSms = planHearingReminders(scheduled, { ...active, smsReminderOverride: false }, prefs);
    expect(noSms.every((r) => r.channel === 'EMAIL')).toBe(true);

    const forced = planHearingReminders(
      scheduled,
      { ...active, twoHourReminderOverride: true },
      { ...prefs, twoHourEnabled: false },
    );
    expect(forced.some((r) => r.type === 'TWO_HOUR')).toBe(true);

    expect(planHearingReminders(scheduled, { ...active, status: 'CLOSED' }, prefs)).toEqual([]);
  });
});

describe('cases API', () => {
  it('creates a case with its first hearing and plans its reminders', async () => {
    const { app, client, as } = await setup();

    const res = await as(request(app).post('/api/cases')).send(caseBody(client.id));
    expect(res.status).toBe(201);

    const detail = await as(request(app).get(`/api/cases/${res.body.case.id}`));
    expect(detail.status).toBe(200);
    expect(detail.body.case.client.name).toBe('Ramesh Gupta');
    expect(detail.body.case.hearings).toHaveLength(1);
    const hearing = detail.body.case.hearings[0];
    expect(istDateString(new Date(hearing.scheduledAt))).toBe(istDay(10));

    expect(summary(await remindersOf(hearing.id))).toEqual([
      'DAY_BEFORE/EMAIL/PENDING',
      'DAY_BEFORE/SMS/PENDING',
      'MISSING_OUTCOME/EMAIL/PENDING',
      'TWO_HOUR/SMS/PENDING',
    ]);

    const list = await as(request(app).get('/api/cases'));
    expect(list.body.cases).toHaveLength(1);
    expect(list.body.cases[0].nextHearing.id).toBe(hearing.id);
  });

  it('rejects a first hearing in the past, a duplicate number and a foreign client', async () => {
    const { app, client, as } = await setup();

    const past = await as(request(app).post('/api/cases')).send(
      caseBody(client.id, { firstHearing: { date: istDay(-1), time: '10:30' } }),
    );
    expect(past.status).toBe(400);
    expect(past.body.fields).toEqual({
      'firstHearing.date': 'Choose a date and time in the future',
    });

    await as(request(app).post('/api/cases')).send(caseBody(client.id)).expect(201);
    const duplicate = await as(request(app).post('/api/cases')).send(
      caseBody(client.id, { caseNumber: 'rcs/412/2026' }),
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.fields.caseNumber).toMatch(/already have a case/);

    const other = await signUpLawyer(app);
    const foreign = await request(app)
      .post('/api/cases')
      .set('Cookie', other.cookie)
      .send(caseBody(client.id, { caseNumber: 'X/1' }));
    expect(foreign.status).toBe(400);
    expect(foreign.body.fields.clientId).toBe('Choose one of your clients');
    expect(await prisma.case.count()).toBe(1);
  });

  it('moving a hearing cancels old reminders; moving it back reuses them', async () => {
    const { app, client, as } = await setup();
    const caseId = (await as(request(app).post('/api/cases')).send(caseBody(client.id))).body.case
      .id;
    const hearingId = (await prisma.hearing.findFirstOrThrow({ where: { caseId } })).id;

    await as(request(app).put(`/api/hearings/${hearingId}`))
      .send({ date: istDay(12), time: '11:00', purpose: 'Evidence' })
      .expect(200);
    let rows = await remindersOf(hearingId);
    expect(rows.filter((r) => r.status === 'CANCELLED')).toHaveLength(4);
    expect(rows.filter((r) => r.status === 'PENDING')).toHaveLength(4);

    // Pretend the day-before email for the new date has gone out.
    const sent = rows.find(
      (r) => r.status === 'PENDING' && r.type === 'DAY_BEFORE' && r.channel === 'EMAIL',
    )!;
    await prisma.reminder.update({
      where: { id: sent.id },
      data: { status: 'SENT', sentAt: new Date() },
    });

    // Back to the original slot: the four cancelled rows are reactivated, not copied.
    await as(request(app).put(`/api/hearings/${hearingId}`))
      .send({ date: istDay(10), time: '10:30', purpose: 'Evidence' })
      .expect(200);
    rows = await remindersOf(hearingId);
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r.status === 'PENDING')).toHaveLength(4);

    // And to the second slot again: the SENT reminder stays sent and is not recreated.
    await as(request(app).put(`/api/hearings/${hearingId}`))
      .send({ date: istDay(12), time: '11:00', purpose: 'Evidence' })
      .expect(200);
    rows = await remindersOf(hearingId);
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.id === sent.id)!.status).toBe('SENT');
    expect(rows.filter((r) => r.status === 'PENDING')).toHaveLength(3);
  });

  it('applies per-case overrides and the lawyer defaults', async () => {
    const { app, client, lawyer, as } = await setup();
    await prisma.lawyer.update({ where: { id: lawyer.id }, data: { dayBeforeEnabled: false } });

    const res = await as(request(app).post('/api/cases')).send(
      caseBody(client.id, { smsReminderOverride: false }),
    );
    const caseId = res.body.case.id;
    const hearingId = (await prisma.hearing.findFirstOrThrow({ where: { caseId } })).id;
    expect(summary(await remindersOf(hearingId))).toEqual(['MISSING_OUTCOME/EMAIL/PENDING']);

    // Turning SMS back on for the case adds the two-hour SMS straight away.
    const { firstHearing: _first, ...fields } = caseBody(client.id);
    await as(request(app).put(`/api/cases/${caseId}`))
      .send({ ...fields, status: 'ACTIVE', smsReminderOverride: null })
      .expect(200);
    expect(summary(await remindersOf(hearingId))).toEqual([
      'MISSING_OUTCOME/EMAIL/PENDING',
      'TWO_HOUR/SMS/PENDING',
    ]);
  });

  it('closing a case cancels its reminders and reopening restores them', async () => {
    const { app, client, as } = await setup();
    const caseId = (await as(request(app).post('/api/cases')).send(caseBody(client.id))).body.case
      .id;
    const hearingId = (await prisma.hearing.findFirstOrThrow({ where: { caseId } })).id;
    const { firstHearing: _first, ...fields } = caseBody(client.id);

    await as(request(app).put(`/api/cases/${caseId}`))
      .send({ ...fields, status: 'CLOSED' })
      .expect(200);
    expect((await remindersOf(hearingId)).every((r) => r.status === 'CANCELLED')).toBe(true);

    const blocked = await as(request(app).post(`/api/cases/${caseId}/hearings`)).send({
      date: istDay(20),
      time: '10:00',
    });
    expect(blocked.status).toBe(409);

    await as(request(app).put(`/api/cases/${caseId}`))
      .send({ ...fields, status: 'ACTIVE' })
      .expect(200);
    const rows = await remindersOf(hearingId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
  });

  it('cancelling a hearing cancels its reminders', async () => {
    const { app, client, as } = await setup();
    const caseId = (await as(request(app).post('/api/cases')).send(caseBody(client.id))).body.case
      .id;
    const hearingId = (await prisma.hearing.findFirstOrThrow({ where: { caseId } })).id;

    await as(request(app).post(`/api/hearings/${hearingId}/cancel`)).expect(200);

    expect((await remindersOf(hearingId)).every((r) => r.status === 'CANCELLED')).toBe(true);
    expect((await as(request(app).post(`/api/hearings/${hearingId}/cancel`))).status).toBe(409);
  });

  it('only deletes a case that has no time entries', async () => {
    const { app, client, lawyer, as } = await setup();
    const caseId = (await as(request(app).post('/api/cases')).send(caseBody(client.id))).body.case
      .id;
    const entry = await prisma.timeEntry.create({
      data: {
        lawyerId: lawyer.id,
        caseId,
        workDate: new Date('2026-10-01'),
        minutes: 60,
        description: 'Drafting',
        ratePaise: 300000,
        amountPaise: 300000,
      },
    });

    const blocked = await as(request(app).delete(`/api/cases/${caseId}`));
    expect(blocked.status).toBe(409);

    await prisma.timeEntry.delete({ where: { id: entry.id } });
    await as(request(app).delete(`/api/cases/${caseId}`)).expect(204);
    expect(await prisma.hearing.count()).toBe(0);
    expect(await prisma.reminder.count()).toBe(0);
  });
});

describe('logging a hearing outcome', () => {
  // A case whose hearing was earlier today (moved there directly in the database, since
  // the API only schedules hearings in the future).
  async function hearingToday() {
    const ctx = await setup();
    const caseId = (await ctx.as(request(ctx.app).post('/api/cases')).send(caseBody(ctx.client.id)))
      .body.case.id;
    const hearing = await prisma.hearing.findFirstOrThrow({ where: { caseId } });
    await prisma.hearing.update({
      where: { id: hearing.id },
      data: { scheduledAt: new Date(Date.now() - 60 * 1000) },
    });
    return { ...ctx, caseId, hearingId: hearing.id };
  }

  it('records the outcome, bills the time and schedules the next date', async () => {
    const { app, as, caseId, hearingId } = await hearingToday();

    const res = await as(request(app).post(`/api/hearings/${hearingId}/outcome`)).send({
      outcome: 'ADJOURNED',
      outcomeNotes: 'Opposing counsel sought time',
      timeSpentMinutes: 90,
      nextHearing: { date: istDay(30), time: '11:00', purpose: 'Arguments' },
    });
    expect(res.status).toBe(200);

    const done = await prisma.hearing.findUniqueOrThrow({ where: { id: hearingId } });
    expect(done).toMatchObject({ status: 'COMPLETED', outcome: 'ADJOURNED', timeSpentMinutes: 90 });
    expect(done.loggedAt).not.toBeNull();
    expect((await remindersOf(hearingId)).some((r) => r.status === 'PENDING')).toBe(false);

    // 90 minutes at the client's ₹3,000/hour = ₹4,500.
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { hearingId } });
    expect(entry).toMatchObject({ minutes: 90, ratePaise: 300000, amountPaise: 450000, caseId });

    const next = await prisma.hearing.findFirstOrThrow({ where: { caseId, status: 'SCHEDULED' } });
    expect(istDateString(next.scheduledAt)).toBe(istDay(30));
    expect(next.purpose).toBe('Arguments');
    expect(summary(await remindersOf(next.id))).toHaveLength(4);

    const again = await as(request(app).post(`/api/hearings/${hearingId}/outcome`)).send({
      outcome: 'HEARD',
    });
    expect(again.status).toBe(409);
  });

  it('can close the case when it is disposed of', async () => {
    const { app, as, caseId, hearingId } = await hearingToday();

    await as(request(app).post(`/api/hearings/${hearingId}/outcome`))
      .send({ outcome: 'DISPOSED', closeCase: true })
      .expect(200);

    expect((await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).status).toBe('CLOSED');
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it('refuses an outcome before the hearing day and a next date before the hearing', async () => {
    const { app, client, as } = await setup();
    const caseId = (await as(request(app).post('/api/cases')).send(caseBody(client.id))).body.case
      .id;
    const future = await prisma.hearing.findFirstOrThrow({ where: { caseId } });
    const early = await as(request(app).post(`/api/hearings/${future.id}/outcome`)).send({
      outcome: 'HEARD',
    });
    expect(early.status).toBe(409);

    await prisma.hearing.update({
      where: { id: future.id },
      data: { scheduledAt: new Date(Date.now() - 2 * DAY) },
    });
    const backwards = await as(request(app).post(`/api/hearings/${future.id}/outcome`)).send({
      outcome: 'ADJOURNED',
      nextHearing: { date: istDay(-3), time: '10:00' },
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.fields['nextHearing.date']).toBeDefined();
  });

  it('lists hearings by IST date range and flags missing outcomes', async () => {
    const { app, as, hearingId } = await hearingToday();
    await prisma.hearing.update({
      where: { id: hearingId },
      data: { scheduledAt: new Date(Date.now() - 2 * DAY) },
    });

    const range = await as(request(app).get(`/api/hearings?from=${istDay(-3)}&to=${istDay(0)}`));
    expect(range.status).toBe(200);
    expect(range.body.hearings.map((h: { id: string }) => h.id)).toEqual([hearingId]);

    const missing = await as(request(app).get('/api/hearings/missing-outcome'));
    expect(missing.body.hearings.map((h: { id: string }) => h.id)).toEqual([hearingId]);

    const bad = await as(request(app).get(`/api/hearings?from=${istDay(0)}&to=${istDay(-3)}`));
    expect(bad.status).toBe(400);
  });
});

describe('ownership', () => {
  it("returns 404 for every route on another lawyer's case or hearing", async () => {
    const { app, client, as } = await setup();
    const caseId = (await as(request(app).post('/api/cases')).send(caseBody(client.id))).body.case
      .id;
    const hearingId = (await prisma.hearing.findFirstOrThrow({ where: { caseId } })).id;
    const other = await signUpLawyer(app);
    const asOther = (r: request.Test) => r.set('Cookie', other.cookie);
    const { firstHearing: slot, ...fields } = caseBody(client.id);

    expect((await asOther(request(app).get('/api/cases'))).body.cases).toEqual([]);
    expect((await asOther(request(app).get(`/api/cases/${caseId}`))).status).toBe(404);
    expect(
      (
        await asOther(request(app).put(`/api/cases/${caseId}`)).send({
          ...fields,
          status: 'CLOSED',
        })
      ).status,
    ).not.toBe(200);
    expect((await asOther(request(app).delete(`/api/cases/${caseId}`))).status).toBe(404);
    expect(
      (await asOther(request(app).post(`/api/cases/${caseId}/hearings`)).send(slot)).status,
    ).toBe(404);
    expect((await asOther(request(app).put(`/api/hearings/${hearingId}`)).send(slot)).status).toBe(
      404,
    );
    expect((await asOther(request(app).post(`/api/hearings/${hearingId}/cancel`))).status).toBe(
      404,
    );
    expect(
      (
        await asOther(request(app).post(`/api/hearings/${hearingId}/outcome`)).send({
          outcome: 'HEARD',
        })
      ).status,
    ).toBe(404);
    expect(
      (await asOther(request(app).get(`/api/hearings?from=${istDay(0)}&to=${istDay(30)}`))).body
        .hearings,
    ).toEqual([]);

    const untouched = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
    expect(untouched.status).toBe('ACTIVE');
    expect(await prisma.hearing.count({ where: { caseId } })).toBe(1);
  });
});
