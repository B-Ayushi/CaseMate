import { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

const EXPECTED_TABLES = [
  'cases',
  'client_notes',
  'clients',
  'hearings',
  'invoices',
  'lawyers',
  'reminders',
  'time_entries',
];

class Rollback extends Error {}

// Runs `work` inside a transaction that is always rolled back, so tests leave no rows behind.
async function inRolledBackTransaction(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(
    prisma.$transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

describe('database schema', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('has every table from the design', async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'
      ORDER BY table_name`;

    expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES);
  });

  it('rejects a duplicate reminder for the same hearing, type, channel and time', async () => {
    await inRolledBackTransaction(async (tx) => {
      const lawyer = await tx.lawyer.create({
        data: {
          name: 'Schema Test',
          email: 'schema-test@test.invalid',
          phone: '0',
          barCouncilNumber: '0',
          passwordHash: 'x',
        },
      });
      const client = await tx.client.create({
        data: { lawyerId: lawyer.id, name: 'Schema Test', phone: '0' },
      });
      const legalCase = await tx.case.create({
        data: {
          lawyerId: lawyer.id,
          clientId: client.id,
          title: 'Schema Test',
          caseNumber: 'SCHEMA/1',
          courtName: 'Schema Test',
        },
      });
      const hearing = await tx.hearing.create({
        data: {
          lawyerId: lawyer.id,
          caseId: legalCase.id,
          scheduledAt: new Date('2030-01-01T05:00:00Z'),
        },
      });
      const reminder = {
        lawyerId: lawyer.id,
        hearingId: hearing.id,
        type: 'DAY_BEFORE' as const,
        channel: 'EMAIL' as const,
        sendAt: new Date('2029-12-31T05:00:00Z'),
      };
      await tx.reminder.create({ data: reminder });

      await expect(tx.reminder.create({ data: reminder })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  it('rejects a second daily summary for the same lawyer and day', async () => {
    await inRolledBackTransaction(async (tx) => {
      const lawyer = await tx.lawyer.create({
        data: {
          name: 'Schema Test',
          email: 'schema-test@test.invalid',
          phone: '0',
          barCouncilNumber: '0',
          passwordHash: 'x',
        },
      });
      const summary = {
        lawyerId: lawyer.id,
        type: 'DAILY_SUMMARY' as const,
        channel: 'EMAIL' as const,
        summaryDate: new Date('2030-01-01'),
      };
      await tx.reminder.create({
        data: { ...summary, sendAt: new Date('2030-01-01T01:30:00Z') },
      });

      await expect(
        tx.reminder.create({ data: { ...summary, sendAt: new Date('2030-01-01T02:00:00Z') } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
