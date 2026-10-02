import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { amountForMinutes } from '../src/lib/money.js';
import { prisma } from '../src/lib/prisma.js';
import { addDaysToIsoDay, istDateString, istDateTimeToUtc } from '../src/lib/time.js';
import { isOverdue } from '../src/services/invoiceStatus.js';
import { buildTestApp, resetDatabase, signUpLawyer, testConfig } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const TODAY = () => istDateString(new Date());

// A lawyer with a client (at `ratePaise` an hour, or the default when null) and a case.
async function setup(app: Express, ratePaise: number | null = 300000) {
  const { cookie, lawyer } = await signUpLawyer(app);
  const as = (r: request.Test) => r.set('Cookie', cookie);
  let n = 0;

  async function addClient(
    rate: number | null = ratePaise,
    email: string | null = 'client@example.com',
  ) {
    n += 1;
    const res = await as(request(app).post('/api/clients')).send({
      name: `Client ${n}`,
      phone: '9822011223',
      email,
      address: '12, Shanti Nagar\nPune 411038',
      hourlyRatePaise: rate,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.client as { id: string; name: string };
  }

  async function addCase(clientId: string) {
    n += 1;
    const res = await as(request(app).post('/api/cases')).send({
      clientId,
      title: `Case ${n}`,
      caseNumber: `RCS/${n}/2026`,
      courtName: 'Civil Court, Pune',
      firstHearing: { date: istDateString(new Date(Date.now() + 10 * DAY)), time: '10:30' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.case.id as string;
  }

  async function logTime(caseId: string, minutes: number, workDate = TODAY()) {
    const res = await as(request(app).post('/api/time-entries')).send({
      caseId,
      workDate,
      minutes,
      description: 'Drafting',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.timeEntry as { id: string; ratePaise: number; amountPaise: number };
  }

  const invoice = (clientId: string, timeEntryIds: string[], extra: object = {}) =>
    as(request(app).post('/api/invoices')).send({ clientId, timeEntryIds, ...extra });

  const client = await addClient();
  const caseId = await addCase(client.id);
  return { app, cookie, as, lawyer, client, caseId, addClient, addCase, logTime, invoice };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('amounts', () => {
  it('is rate × minutes / 60, rounded to the nearest paisa', () => {
    expect(amountForMinutes(60, 300000)).toBe(300000);
    expect(amountForMinutes(90, 300000)).toBe(450000);
    expect(amountForMinutes(7, 100000)).toBe(11667); // 11666.67
    expect(amountForMinutes(1, 100000)).toBe(1667); // 1666.67
    expect(amountForMinutes(10, 100001)).toBe(16667); // 16666.83
    expect(amountForMinutes(1, 30)).toBe(1); // 0.5 rounds up
    expect(amountForMinutes(1, 29)).toBe(0); // 0.48
    expect(amountForMinutes(24 * 60, 50_000_000)).toBe(1_200_000_000);
  });

  it('the server calculates and stores the amount; the client cannot set it', async () => {
    const { app } = buildTestApp();
    const a = await setup(app, 100000);
    const res = await a.as(request(app).post('/api/time-entries')).send({
      caseId: a.caseId,
      workDate: TODAY(),
      minutes: 7,
      description: 'Call with client',
      amountPaise: 1,
      ratePaise: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.timeEntry).toMatchObject({ minutes: 7, ratePaise: 100000, amountPaise: 11667 });
  });

  it('validates minutes, dates and the description', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const res = await a.as(request(app).post('/api/time-entries')).send({
      caseId: a.caseId,
      workDate: '2026-02-30',
      minutes: 0,
      description: ' ',
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['description', 'minutes', 'workDate']);
    const tooLong = await a.as(request(app).post('/api/time-entries')).send({
      caseId: a.caseId,
      workDate: TODAY(),
      minutes: 24 * 60 + 1,
      description: 'Too long',
    });
    expect(tooLong.body.fields.minutes).toBe('One entry can be at most 24 hours');
  });
});

describe('rates', () => {
  it('uses the client rate, else the default, and keeps each entry at its own rate', async () => {
    const { app } = buildTestApp();
    const a = await setup(app, 300000);
    const noRateClient = await a.addClient(null);
    const noRateCase = await a.addCase(noRateClient.id);
    await a
      .as(request(app).patch('/api/settings/billing'))
      .send({ defaultHourlyRatePaise: 200000 });

    const rate = await a.as(request(app).get(`/api/time-entries/rate?caseId=${noRateCase}`));
    expect(rate.body.rate).toMatchObject({ ratePaise: 200000, source: 'default' });

    const clientEntry = await a.logTime(a.caseId, 60);
    const defaultEntry = await a.logTime(noRateCase, 60);
    expect(clientEntry).toMatchObject({ ratePaise: 300000, amountPaise: 300000 });
    expect(defaultEntry).toMatchObject({ ratePaise: 200000, amountPaise: 200000 });
    const invoice = (await a.invoice(a.client.id, [clientEntry.id])).body.invoice;

    // Both rates change.
    await a
      .as(request(app).put(`/api/clients/${a.client.id}`))
      .send({ name: 'Client 1', phone: '9822011223', hourlyRatePaise: 500000 })
      .expect(200);
    await a
      .as(request(app).patch('/api/settings/billing'))
      .send({ defaultHourlyRatePaise: 250000 });

    const stored = await prisma.timeEntry.findMany({ orderBy: { ratePaise: 'asc' } });
    expect(stored.map((e) => [e.ratePaise, e.amountPaise])).toEqual([
      [200000, 200000],
      [300000, 300000],
    ]);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).totalPaise).toBe(
      300000,
    );

    // Editing an old entry's time keeps its own rate.
    const edited = await a
      .as(request(app).put(`/api/time-entries/${defaultEntry.id}`))
      .send({ workDate: TODAY(), minutes: 90, description: 'Drafting' });
    expect(edited.body.timeEntry).toMatchObject({ ratePaise: 200000, amountPaise: 300000 });

    // New time uses the new rates.
    expect(await a.logTime(a.caseId, 60)).toMatchObject({ ratePaise: 500000 });
    expect(await a.logTime(noRateCase, 60)).toMatchObject({ ratePaise: 250000 });
  });

  it('validates the default rate', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const bad = await a
      .as(request(app).patch('/api/settings/billing'))
      .send({ defaultHourlyRatePaise: 50_000_001 });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.defaultHourlyRatePaise).toBe('Rate can be at most ₹5,00,000 an hour');
    const ok = await a
      .as(request(app).patch('/api/settings/billing'))
      .send({ defaultHourlyRatePaise: 250050 });
    expect(ok.body.billing).toEqual({ defaultHourlyRatePaise: 250050 });
    expect((await a.as(request(app).get('/api/settings/billing'))).body.billing).toEqual({
      defaultHourlyRatePaise: 250050,
    });
  });
});

describe('time entry list', () => {
  it('filters by client, case, date range and billed or unbilled', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const other = await a.addClient();
    const otherCase = await a.addCase(other.id);
    const old = await a.logTime(a.caseId, 30, addDaysToIsoDay(TODAY(), -40));
    const recent = await a.logTime(a.caseId, 45);
    const elsewhere = await a.logTime(otherCase, 60);
    await a.invoice(a.client.id, [old.id]).expect(201);

    const ids = async (query: string) =>
      (await a.as(request(app).get(`/api/time-entries?${query}`))).body.timeEntries
        .map((e: { id: string }) => e.id)
        .sort();

    expect(await ids('')).toEqual([old.id, recent.id, elsewhere.id].sort());
    expect(await ids(`clientId=${a.client.id}`)).toEqual([old.id, recent.id].sort());
    expect(await ids(`caseId=${otherCase}`)).toEqual([elsewhere.id]);
    expect(await ids(`from=${addDaysToIsoDay(TODAY(), -7)}&to=${TODAY()}`)).toEqual(
      [recent.id, elsewhere.id].sort(),
    );
    expect(await ids('billed=billed')).toEqual([old.id]);
    expect(await ids('billed=unbilled')).toEqual([recent.id, elsewhere.id].sort());

    const listed = (await a.as(request(app).get(`/api/time-entries?caseId=${a.caseId}`))).body
      .timeEntries;
    expect(listed.find((e: { id: string }) => e.id === old.id).invoice).toMatchObject({
      number: 'INV-001',
      status: 'DRAFT',
      displayStatus: 'DRAFT',
    });
  });
});

describe('invoices', () => {
  it('totals the chosen entries, defaults the due date to 15 days, and validates', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const e1 = await a.logTime(a.caseId, 90);
    const e2 = await a.logTime(a.caseId, 7);

    const res = await a.invoice(a.client.id, [e1.id, e2.id], { issueDate: '2026-10-02' });
    expect(res.status).toBe(201);
    expect(res.body.invoice).toMatchObject({
      number: 'INV-001',
      status: 'DRAFT',
      displayStatus: 'DRAFT',
      issueDate: '2026-10-02',
      dueDate: '2026-10-17',
      totalPaise: 450000 + 35000,
      entryCount: 2,
    });

    const e3 = await a.logTime(a.caseId, 60);
    const bad = await a.invoice(a.client.id, [e3.id], {
      issueDate: '2026-10-10',
      dueDate: '2026-10-09',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.dueDate).toMatch(/before the issue date/);
    expect((await a.invoice(a.client.id, [])).status).toBe(400);

    const edited = await a
      .as(request(app).patch(`/api/invoices/${res.body.invoice.id}`))
      .send({ dueDate: '2026-10-31', notes: 'Bank transfer please' });
    expect(edited.body.invoice).toMatchObject({
      dueDate: '2026-10-31',
      notes: 'Bank transfer please',
    });
  });

  it('numbers invoices created at the same moment with no duplicates and no gaps', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const b = await setup(app);
    const clients = [a.client, await a.addClient(), await a.addClient()];
    const jobs: { clientId: string; entryId: string }[] = [];
    for (const client of clients) {
      const caseId = await a.addCase(client.id);
      for (let i = 0; i < 2; i++) {
        jobs.push({ clientId: client.id, entryId: (await a.logTime(caseId, 30 + i)).id });
      }
    }
    const bEntry = await b.logTime(b.caseId, 60);

    const results = await Promise.all([
      ...jobs.map((job) => a.invoice(job.clientId, [job.entryId])),
      b.invoice(b.client.id, [bEntry.id]),
    ]);

    expect(results.map((r) => r.status)).toEqual(Array(jobs.length + 1).fill(201));
    const numbers = results.slice(0, jobs.length).map((r) => r.body.invoice.number as string);
    expect(numbers.sort()).toEqual([
      'INV-001',
      'INV-002',
      'INV-003',
      'INV-004',
      'INV-005',
      'INV-006',
    ]);
    // Another lawyer has their own sequence.
    expect(results.at(-1)!.body.invoice.number).toBe('INV-001');
  });

  it('never puts the same entry on two invoices, even at the same moment', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const entry = await a.logTime(a.caseId, 60);
    const results = await Promise.all([
      a.invoice(a.client.id, [entry.id]),
      a.invoice(a.client.id, [entry.id]),
      a.invoice(a.client.id, [entry.id]),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await prisma.invoice.count()).toBe(1);
  });

  it('only bills entries of the chosen client', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const other = await a.addClient();
    const otherEntry = await a.logTime(await a.addCase(other.id), 60);
    const res = await a.invoice(a.client.id, [otherEntry.id]);
    expect(res.status).toBe(409);
    expect(await prisma.invoice.count()).toBe(0);
  });

  it('deleting a draft frees its entries; sent and paid invoices cannot be deleted', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const e1 = await a.logTime(a.caseId, 60);
    const e2 = await a.logTime(a.caseId, 30);
    const first = (await a.invoice(a.client.id, [e1.id])).body.invoice;
    const draft = (await a.invoice(a.client.id, [e2.id])).body.invoice;
    expect(draft.number).toBe('INV-002');

    await a.as(request(app).delete(`/api/invoices/${draft.id}`)).expect(204);
    expect(
      (await prisma.timeEntry.findUniqueOrThrow({ where: { id: e2.id } })).invoiceId,
    ).toBeNull();
    expect(await prisma.invoice.count({ where: { id: draft.id } })).toBe(0);
    // The freed entry can be billed again, and the latest number is reused: no gap.
    const again = (await a.invoice(a.client.id, [e2.id])).body.invoice;
    expect(again.number).toBe('INV-002');

    await a.as(request(app).post(`/api/invoices/${first.id}/mark-sent`)).expect(200);
    const sent = await a.as(request(app).delete(`/api/invoices/${first.id}`));
    expect(sent.status).toBe(409);
    expect(sent.body.error).toBe("Invoice INV-001 has been sent, so it can't be deleted.");
    await a.as(request(app).post(`/api/invoices/${first.id}/mark-paid`)).expect(200);
    expect((await a.as(request(app).delete(`/api/invoices/${first.id}`))).body.error).toMatch(
      /has been paid/,
    );
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: e1.id } })).invoiceId).toBe(
      first.id,
    );
  });

  it('locks invoiced entries against changes, with the reason', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const entry = await a.logTime(a.caseId, 60);
    const invoice = (await a.invoice(a.client.id, [entry.id])).body.invoice;

    const edit = await a
      .as(request(app).put(`/api/time-entries/${entry.id}`))
      .send({ workDate: TODAY(), minutes: 90, description: 'More' });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toBe(
      'This time is on draft invoice INV-001. Delete that draft to change it.',
    );
    const del = await a.as(request(app).delete(`/api/time-entries/${entry.id}`));
    expect(del.status).toBe(409);

    await a.as(request(app).post(`/api/invoices/${invoice.id}/mark-sent`)).expect(200);
    const afterSend = await a
      .as(request(app).put(`/api/time-entries/${entry.id}`))
      .send({ workDate: TODAY(), minutes: 90, description: 'More' });
    expect(afterSend.body.error).toBe(
      "This time is on invoice INV-001, which has been sent, so it can't be changed.",
    );
    expect(await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({
      minutes: 60,
      amountPaise: 300000,
    });
  });

  it('moves through DRAFT, SENT and PAID', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const invoice = (await a.invoice(a.client.id, [(await a.logTime(a.caseId, 60)).id])).body
      .invoice;

    const sent = await a.as(request(app).post(`/api/invoices/${invoice.id}/mark-sent`));
    expect(sent.body.invoice).toMatchObject({ status: 'SENT' });
    expect(sent.body.invoice.sentAt).toEqual(expect.any(String));
    const paid = await a.as(request(app).post(`/api/invoices/${invoice.id}/mark-paid`));
    expect(paid.body.invoice).toMatchObject({ status: 'PAID', displayStatus: 'PAID' });
    expect(paid.body.invoice.paidAt).toEqual(expect.any(String));
    expect((await a.as(request(app).post(`/api/invoices/${invoice.id}/mark-sent`))).status).toBe(
      409,
    );
    expect(
      (await a.as(request(app).patch(`/api/invoices/${invoice.id}`)).send({ dueDate: TODAY() }))
        .status,
    ).toBe(409);
  });
});

describe('overdue', () => {
  it('is sent, not paid, and due before today in IST', () => {
    const due = new Date('2026-10-14T00:00:00Z'); // due on 14 Oct (IST day)
    const sent = { status: 'SENT' as const, dueDate: due };
    // 11:59 PM IST on the 14th is still the due day.
    expect(isOverdue(sent, istDateTimeToUtc('2026-10-14', '23:59'))).toBe(false);
    // 12:01 AM IST on the 15th is overdue, although it is still the 14th in UTC.
    const justAfter = istDateTimeToUtc('2026-10-15', '00:01');
    expect(justAfter.toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(isOverdue(sent, justAfter)).toBe(true);
    expect(isOverdue({ status: 'PAID', dueDate: due }, justAfter)).toBe(false);
    expect(isOverdue({ status: 'DRAFT', dueDate: due }, justAfter)).toBe(false);
  });

  it('shows on the invoice list and the dashboard', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const yesterday = addDaysToIsoDay(TODAY(), -1);
    const make = async (minutes: number) => {
      const entry = await a.logTime(a.caseId, minutes);
      return (
        await a.invoice(a.client.id, [entry.id], {
          issueDate: addDaysToIsoDay(TODAY(), -20),
          dueDate: yesterday,
        })
      ).body.invoice;
    };
    const overdue = await make(60);
    const paid = await make(30);
    await make(15); // stays a draft
    const dueToday = (
      await a.invoice(a.client.id, [(await a.logTime(a.caseId, 45)).id], { dueDate: TODAY() })
    ).body.invoice;
    for (const id of [overdue.id, paid.id, dueToday.id]) {
      await a.as(request(app).post(`/api/invoices/${id}/mark-sent`)).expect(200);
    }
    await a.as(request(app).post(`/api/invoices/${paid.id}/mark-paid`)).expect(200);

    const list = (await a.as(request(app).get('/api/invoices'))).body.invoices as {
      number: string;
      displayStatus: string;
    }[];
    expect(Object.fromEntries(list.map((i) => [i.number, i.displayStatus]))).toEqual({
      'INV-001': 'OVERDUE',
      'INV-002': 'PAID',
      'INV-003': 'DRAFT',
      'INV-004': 'SENT',
    });
    const onlyOverdue = (await a.as(request(app).get('/api/invoices?status=OVERDUE'))).body
      .invoices;
    expect(onlyOverdue.map((i: { number: string }) => i.number)).toEqual(['INV-001']);

    const dashboard = (await a.as(request(app).get('/api/dashboard'))).body;
    expect(dashboard.counts).toMatchObject({ unpaidInvoices: 2, unpaidPaise: 300000 + 225000 });
    expect(dashboard.needsAttention.overdueInvoices).toEqual([
      {
        id: overdue.id,
        number: 'INV-001',
        totalPaise: 300000,
        dueDate: yesterday,
        daysOverdue: 1,
        client: { id: a.client.id, name: a.client.name },
      },
    ]);
  });
});

describe('sending', () => {
  it('emails the PDF to the client and marks the invoice SENT', async () => {
    const { app, sentEmails } = buildTestApp();
    const a = await setup(app);
    const invoice = (await a.invoice(a.client.id, [(await a.logTime(a.caseId, 60)).id])).body
      .invoice;

    const res = await a.as(request(app).post(`/api/invoices/${invoice.id}/send`));

    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('SENT');
    expect(sentEmails).toHaveLength(1);
    const email = sentEmails[0]!;
    expect(email.to).toBe('client@example.com');
    expect(email.subject).toMatch(/^Invoice INV-001 from /);
    expect(email.text).toContain('₹3,000');
    expect(email.attachments?.[0]).toMatchObject({
      filename: 'INV-001.pdf',
      contentType: 'application/pdf',
    });
    // Nodemailer's JSON transport (no delivery) leaves the attachment base64-encoded.
    const content: unknown = email.attachments![0]!.content;
    const pdf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'base64');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('keeps the invoice a DRAFT and explains why when the email fails', async () => {
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
        sms: { name: 'unused', async send() {} },
      });
      const a = await setup(app);
      const invoice = (await a.invoice(a.client.id, [(await a.logTime(a.caseId, 60)).id])).body
        .invoice;

      const res = await a.as(request(app).post(`/api/invoices/${invoice.id}/send`));

      expect(res.status).toBe(502);
      expect(res.body.error).toBe(
        'Email could not be sent: the secure connection to the mail server failed. The invoice is still a draft.',
      );
      expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
        status: 'DRAFT',
        sentAt: null,
      });
    } finally {
      log.mockRestore();
    }
  });

  it('says so when the client has no email address', async () => {
    const { app, sentEmails } = buildTestApp();
    const a = await setup(app);
    const noEmail = await a.addClient(300000, null);
    const entry = await a.logTime(await a.addCase(noEmail.id), 60);
    const invoice = (await a.invoice(noEmail.id, [entry.id])).body.invoice;

    const res = await a.as(request(app).post(`/api/invoices/${invoice.id}/send`));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/has no email address/);
    expect(sentEmails).toHaveLength(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
      'DRAFT',
    );
  });

  it('downloads the invoice as a real PDF', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const invoice = (await a.invoice(a.client.id, [(await a.logTime(a.caseId, 60)).id])).body
      .invoice;
    const res = await a
      .as(request(app).get(`/api/invoices/${invoice.id}/pdf`))
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="INV-001.pdf"');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toMatch(/%%EOF/);
    // The Noto Sans font (with the ₹ sign) is embedded.
    expect(pdf.toString('latin1')).toContain('NotoSans');
  });
});

describe('hearing log', () => {
  async function pastHearing(a: Awaited<ReturnType<typeof setup>>) {
    const hearing = await prisma.hearing.findFirstOrThrow({ where: { caseId: a.caseId } });
    await prisma.hearing.update({
      where: { id: hearing.id },
      data: { scheduledAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    return hearing.id;
  }

  it('logging an outcome with time creates a linked entry; editing it updates the entry', async () => {
    const { app } = buildTestApp();
    const a = await setup(app, 300000);
    const hearingId = await pastHearing(a);

    await a
      .as(request(app).post(`/api/hearings/${hearingId}/outcome`))
      .send({ outcome: 'ADJOURNED', timeSpentMinutes: 90, closeCase: false })
      .expect(200);
    let entry = await prisma.timeEntry.findFirstOrThrow({ where: { hearingId } });
    expect(entry).toMatchObject({
      minutes: 90,
      ratePaise: 300000,
      amountPaise: 450000,
      description: 'Hearing: Adjourned',
      invoiceId: null,
    });

    // The client's rate changes; the edited entry keeps its own.
    await a
      .as(request(app).put(`/api/clients/${a.client.id}`))
      .send({ name: 'Client 1', phone: '9822011223', hourlyRatePaise: 600000 })
      .expect(200);
    const edit = (body: object) =>
      a.as(request(app).put(`/api/hearings/${hearingId}/outcome`)).send(body);

    await edit({ outcome: 'HEARD', outcomeNotes: 'Arguments heard', timeSpentMinutes: 120 }).expect(
      200,
    );
    entry = await prisma.timeEntry.findFirstOrThrow({ where: { hearingId } });
    expect(entry).toMatchObject({
      id: entry.id,
      minutes: 120,
      ratePaise: 300000,
      amountPaise: 600000,
      description: 'Hearing: Heard',
    });
    expect(await prisma.hearing.findUniqueOrThrow({ where: { id: hearingId } })).toMatchObject({
      outcome: 'HEARD',
      outcomeNotes: 'Arguments heard',
      timeSpentMinutes: 120,
    });

    // Zero time removes the entry; time again creates one at today's rate.
    await edit({ outcome: 'HEARD', timeSpentMinutes: 0 }).expect(200);
    expect(await prisma.timeEntry.count({ where: { hearingId } })).toBe(0);
    await edit({ outcome: 'HEARD', timeSpentMinutes: 30 }).expect(200);
    entry = await prisma.timeEntry.findFirstOrThrow({ where: { hearingId } });
    expect(entry).toMatchObject({ minutes: 30, ratePaise: 600000, amountPaise: 300000 });

    // Once invoiced, the time is locked but the rest of the outcome can still be corrected.
    await a.invoice(a.client.id, [entry.id]).expect(201);
    const locked = await edit({ outcome: 'HEARD', timeSpentMinutes: 45 });
    expect(locked.status).toBe(409);
    expect(locked.body.fields.timeSpentMinutes).toBe(
      'This time is on draft invoice INV-001. Delete that draft to change it.',
    );
    await edit({
      outcome: 'ORDER_RESERVED',
      outcomeNotes: 'Order reserved',
      timeSpentMinutes: 30,
    }).expect(200);
    expect(await prisma.timeEntry.findFirstOrThrow({ where: { hearingId } })).toMatchObject({
      minutes: 30,
      amountPaise: 300000,
    });
  });

  it("editing a hearing's time entry keeps the hearing's time spent in step", async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const hearingId = await pastHearing(a);
    await a
      .as(request(app).post(`/api/hearings/${hearingId}/outcome`))
      .send({ outcome: 'HEARD', timeSpentMinutes: 60, closeCase: false })
      .expect(200);
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { hearingId } });

    await a
      .as(request(app).put(`/api/time-entries/${entry.id}`))
      .send({
        workDate: entry.workDate.toISOString().slice(0, 10),
        minutes: 75,
        description: 'Hearing',
      })
      .expect(200);
    expect(
      (await prisma.hearing.findUniqueOrThrow({ where: { id: hearingId } })).timeSpentMinutes,
    ).toBe(75);
    await a.as(request(app).delete(`/api/time-entries/${entry.id}`)).expect(204);
    expect(
      (await prisma.hearing.findUniqueOrThrow({ where: { id: hearingId } })).timeSpentMinutes,
    ).toBeNull();
  });

  it('only a logged outcome can be edited', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const hearing = await prisma.hearing.findFirstOrThrow({ where: { caseId: a.caseId } });
    const res = await a
      .as(request(app).put(`/api/hearings/${hearing.id}/outcome`))
      .send({ outcome: 'HEARD', timeSpentMinutes: 30 });
    expect(res.status).toBe(409);
  });
});

describe('monthly summary', () => {
  it('reports billed, received, outstanding and unbilled time for the month', async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const month = TODAY().slice(0, 7);
    const lastMonthDay = addDaysToIsoDay(`${month}-01`, -1);

    const make = async (minutes: number, issueDate = TODAY()) =>
      (await a.invoice(a.client.id, [(await a.logTime(a.caseId, minutes)).id], { issueDate })).body
        .invoice;
    const paid = await make(60); // ₹3,000
    const sent = await make(30); // ₹1,500
    await make(20); // ₹1,000, a draft: not billed yet
    const lastMonth = await make(120, lastMonthDay); // ₹6,000, issued last month, paid now
    for (const inv of [paid, sent, lastMonth]) {
      await a.as(request(app).post(`/api/invoices/${inv.id}/mark-sent`)).expect(200);
    }
    for (const inv of [paid, lastMonth]) {
      await a.as(request(app).post(`/api/invoices/${inv.id}/mark-paid`)).expect(200);
    }
    await a.logTime(a.caseId, 45); // unbilled this month: ₹2,250
    await a.logTime(a.caseId, 60, lastMonthDay); // unbilled, last month

    const res = await a.as(request(app).get(`/api/billing/summary?month=${month}`));

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({
      month,
      billed: { paise: 450000, invoices: 2 },
      received: { paise: 300000 + 600000, invoices: 2 },
      outstanding: { paise: 150000, invoices: 1, overduePaise: 0 },
      unbilled: { paise: 225000, minutes: 45, entries: 1 },
    });
    expect((await a.as(request(app).get('/api/billing/summary?month=2026-13'))).status).toBe(400);
  });
});

describe('ownership', () => {
  it("lawyer B can't see or change lawyer A's entries or invoices", async () => {
    const { app } = buildTestApp();
    const a = await setup(app);
    const b = await setup(app);
    const entry = await a.logTime(a.caseId, 60);
    const spare = await a.logTime(a.caseId, 30);
    const invoice = (await a.invoice(a.client.id, [entry.id])).body.invoice;
    const asB = b.as;

    expect((await asB(request(app).get('/api/time-entries'))).body.timeEntries).toEqual([]);
    expect((await asB(request(app).get('/api/invoices'))).body.invoices).toEqual([]);
    const notFound: [string, string, object?][] = [
      ['put', `/api/time-entries/${spare.id}`, { workDate: TODAY(), minutes: 5, description: 'x' }],
      ['delete', `/api/time-entries/${spare.id}`],
      ['get', `/api/time-entries/rate?caseId=${a.caseId}`],
      [
        'post',
        '/api/time-entries',
        { caseId: a.caseId, workDate: TODAY(), minutes: 5, description: 'x' },
      ],
      ['get', `/api/invoices/${invoice.id}`],
      ['patch', `/api/invoices/${invoice.id}`, { dueDate: TODAY() }],
      ['delete', `/api/invoices/${invoice.id}`],
      ['get', `/api/invoices/${invoice.id}/pdf`],
      ['post', `/api/invoices/${invoice.id}/send`],
      ['post', `/api/invoices/${invoice.id}/mark-sent`],
      ['post', `/api/invoices/${invoice.id}/mark-paid`],
      ['post', '/api/invoices', { clientId: a.client.id, timeEntryIds: [spare.id] }],
    ];
    for (const [method, path, body] of notFound) {
      const req = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(
        path,
      );
      const res = await asB(body ? req.send(body) : req);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // A's entries cannot be put on B's invoice either.
    expect((await b.invoice(b.client.id, [spare.id])).status).toBe(409);

    // Nothing of A's changed.
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      status: 'DRAFT',
    });
    expect(await prisma.timeEntry.findUniqueOrThrow({ where: { id: spare.id } })).toMatchObject({
      minutes: 30,
      invoiceId: null,
    });
    const summary = (
      await asB(request(app).get(`/api/billing/summary?month=${TODAY().slice(0, 7)}`))
    ).body.summary;
    expect(summary.unbilled).toEqual({ paise: 0, minutes: 0, entries: 0 });
  });

  it('every billing route needs a login', async () => {
    const { app } = buildTestApp();
    for (const path of [
      '/api/time-entries',
      '/api/invoices',
      '/api/billing/summary?month=2026-10',
    ]) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
  });
});
