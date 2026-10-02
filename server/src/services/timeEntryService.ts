import type { Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import { amountForMinutes } from '../lib/money.js';
import { dateOnly, istDateString } from '../lib/time.js';
import type {
  CreateTimeEntryInput,
  TimeEntryListQuery,
  UpdateTimeEntryInput,
} from '../validators/billingValidators.js';
import { invoiceDisplayStatus } from './invoiceStatus.js';

type Db = Prisma.TransactionClient;

const NOT_FOUND = 'Time entry not found.';

const timeEntrySelect = {
  id: true,
  workDate: true,
  minutes: true,
  description: true,
  ratePaise: true,
  amountPaise: true,
  hearingId: true,
  createdAt: true,
  case: {
    select: {
      id: true,
      title: true,
      caseNumber: true,
      client: { select: { id: true, name: true } },
    },
  },
  invoice: { select: { id: true, number: true, status: true, dueDate: true } },
} satisfies Prisma.TimeEntrySelect;

type TimeEntryRow = Prisma.TimeEntryGetPayload<{ select: typeof timeEntrySelect }>;

// Dates as the IST calendar day "yyyy-MM-dd", and the invoice with its shown status.
function present(entry: TimeEntryRow, now = new Date()) {
  const { invoice, workDate, ...rest } = entry;
  return {
    ...rest,
    workDate: workDate.toISOString().slice(0, 10),
    invoice: invoice
      ? {
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          displayStatus: invoiceDisplayStatus(invoice, now),
        }
      : null,
  };
}

// The hourly rate a new entry for this case would use right now: the client's own rate
// if set, otherwise the lawyer's default.
export async function rateForCase(db: Db, lawyerId: string, caseId: string) {
  const legalCase = await db.case.findFirst({
    where: { id: caseId, lawyerId },
    select: {
      client: { select: { name: true, hourlyRatePaise: true } },
      lawyer: { select: { defaultHourlyRatePaise: true } },
    },
  });
  if (!legalCase) throw new HttpError(404, 'Case not found.');
  const clientRate = legalCase.client.hourlyRatePaise;
  return clientRate !== null
    ? { ratePaise: clientRate, source: 'client' as const, clientName: legalCase.client.name }
    : {
        ratePaise: legalCase.lawyer.defaultHourlyRatePaise,
        source: 'default' as const,
        clientName: legalCase.client.name,
      };
}

export async function listTimeEntries(
  prisma: PrismaClient,
  lawyerId: string,
  query: TimeEntryListQuery,
) {
  const where: Prisma.TimeEntryWhereInput = { lawyerId };
  if (query.caseId) where.caseId = query.caseId;
  if (query.clientId) where.case = { clientId: query.clientId };
  if (query.from || query.to) {
    where.workDate = {
      ...(query.from ? { gte: dateOnly(query.from) } : {}),
      ...(query.to ? { lte: dateOnly(query.to) } : {}),
    };
  }
  if (query.billed === 'billed') where.invoiceId = { not: null };
  if (query.billed === 'unbilled') where.invoiceId = null;

  const entries = await prisma.timeEntry.findMany({
    where,
    orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
    select: timeEntrySelect,
  });
  const now = new Date();
  return entries.map((e) => present(e, now));
}

export async function createTimeEntry(
  prisma: PrismaClient,
  lawyerId: string,
  input: CreateTimeEntryInput,
) {
  return prisma.$transaction(async (tx) => {
    const { ratePaise } = await rateForCase(tx, lawyerId, input.caseId);
    const entry = await tx.timeEntry.create({
      data: {
        lawyerId,
        caseId: input.caseId,
        workDate: dateOnly(input.workDate),
        minutes: input.minutes,
        description: input.description,
        ratePaise,
        amountPaise: amountForMinutes(input.minutes, ratePaise),
      },
      select: timeEntrySelect,
    });
    return present(entry);
  });
}

// Why an invoiced entry is locked, naming the invoice.
function lockedReason(invoice: { number: string; status: string }) {
  return invoice.status === 'DRAFT'
    ? `This time is on draft invoice ${invoice.number}. Delete that draft to change it.`
    : `This time is on invoice ${invoice.number}, which has been ${invoice.status === 'PAID' ? 'paid' : 'sent'}, so it can't be changed.`;
}

async function findEditableEntry(db: Db, lawyerId: string, id: string) {
  const entry = await db.timeEntry.findFirst({
    where: { id, lawyerId },
    include: { invoice: { select: { number: true, status: true } } },
  });
  if (!entry) throw new HttpError(404, NOT_FOUND);
  if (entry.invoice) throw new HttpError(409, lockedReason(entry.invoice));
  return entry;
}

// Changes the date, minutes or description of an entry that is not on an invoice. The
// rate stays the one stored when the entry was made. An entry made by logging a hearing
// outcome keeps the hearing's time spent in step.
export async function updateTimeEntry(
  prisma: PrismaClient,
  lawyerId: string,
  id: string,
  input: UpdateTimeEntryInput,
) {
  return prisma.$transaction(async (tx) => {
    const entry = await findEditableEntry(tx, lawyerId, id);
    // Conditional on still being unbilled, in case an invoice took it a moment ago.
    const { count } = await tx.timeEntry.updateMany({
      where: { id, lawyerId, invoiceId: null },
      data: {
        workDate: dateOnly(input.workDate),
        minutes: input.minutes,
        description: input.description,
        amountPaise: amountForMinutes(input.minutes, entry.ratePaise),
      },
    });
    if (count !== 1) throw new HttpError(409, 'This time has just been added to an invoice.');
    if (entry.hearingId) {
      await tx.hearing.update({
        where: { id: entry.hearingId },
        data: { timeSpentMinutes: input.minutes },
      });
    }
    return present(
      await tx.timeEntry.findUniqueOrThrow({ where: { id }, select: timeEntrySelect }),
    );
  });
}

export async function deleteTimeEntry(prisma: PrismaClient, lawyerId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const entry = await findEditableEntry(tx, lawyerId, id);
    const { count } = await tx.timeEntry.deleteMany({ where: { id, lawyerId, invoiceId: null } });
    if (count !== 1) throw new HttpError(409, 'This time has just been added to an invoice.');
    if (entry.hearingId) {
      await tx.hearing.update({
        where: { id: entry.hearingId },
        data: { timeSpentMinutes: null },
      });
    }
  });
}

// The time entry that belongs to a hearing's logged outcome, kept in step with the
// minutes on the outcome:
// - minutes and no entry yet: create one at the current rate
// - an unbilled entry: update its minutes, amount and description (rate unchanged), or
//   delete it if the time is now zero
// - an invoiced entry: the time cannot change; refused with the reason
export async function syncHearingTimeEntry(
  tx: Db,
  lawyerId: string,
  hearing: { id: string; caseId: string; scheduledAt: Date },
  minutes: number,
  description: string,
) {
  const existing = await tx.timeEntry.findFirst({
    where: { hearingId: hearing.id, lawyerId },
    include: { invoice: { select: { number: true, status: true } } },
  });

  if (existing?.invoice) {
    if (existing.minutes !== minutes) {
      throw new HttpError(409, lockedReason(existing.invoice), {
        timeSpentMinutes: lockedReason(existing.invoice),
      });
    }
    return existing;
  }
  if (existing && minutes === 0) {
    await tx.timeEntry.delete({ where: { id: existing.id } });
    return null;
  }
  if (existing) {
    return tx.timeEntry.update({
      where: { id: existing.id },
      data: {
        minutes,
        description,
        amountPaise: amountForMinutes(minutes, existing.ratePaise),
      },
    });
  }
  if (minutes === 0) return null;

  const { ratePaise } = await rateForCase(tx, lawyerId, hearing.caseId);
  return tx.timeEntry.create({
    data: {
      lawyerId,
      caseId: hearing.caseId,
      hearingId: hearing.id,
      workDate: dateOnly(istDateString(hearing.scheduledAt)),
      minutes,
      description,
      ratePaise,
      amountPaise: amountForMinutes(minutes, ratePaise),
    },
  });
}
