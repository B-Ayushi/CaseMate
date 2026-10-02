import { Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import type { CreateCaseBody, UpdateCaseBody } from '../validators/caseValidators.js';
import { scheduleHearing } from './hearingService.js';
import { syncUpcomingHearings } from './reminderPlanner.js';

const NOT_FOUND = 'Case not found.';

function duplicateCaseNumber(): HttpError {
  return new HttpError(409, 'You already have a case with this number.', {
    caseNumber: 'You already have a case with this number',
  });
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function assertClientOwned(db: Prisma.TransactionClient, lawyerId: string, clientId: string) {
  const client = await db.client.findFirst({
    where: { id: clientId, lawyerId },
    select: { id: true },
  });
  if (!client) {
    throw new HttpError(400, 'Choose one of your clients.', {
      clientId: 'Choose one of your clients',
    });
  }
}

export async function listCases(
  prisma: PrismaClient,
  lawyerId: string,
  filter: { status: 'ACTIVE' | 'CLOSED' | 'ALL'; search?: string; clientId?: string },
) {
  const now = new Date();
  const cases = await prisma.case.findMany({
    where: {
      lawyerId,
      ...(filter.status === 'ALL' ? {} : { status: filter.status }),
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.search
        ? {
            OR: [
              { title: { contains: filter.search } },
              { caseNumber: { contains: filter.search } },
              { courtName: { contains: filter.search } },
              { opposingParty: { contains: filter.search } },
              { client: { name: { contains: filter.search } } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      caseNumber: true,
      caseType: true,
      courtName: true,
      courtroom: true,
      status: true,
      client: { select: { id: true, name: true } },
      hearings: {
        where: { status: 'SCHEDULED', scheduledAt: { gte: now } },
        orderBy: { scheduledAt: 'asc' },
        take: 1,
        select: { id: true, scheduledAt: true, purpose: true },
      },
    },
  });

  // Cases with the soonest next hearing first; cases with no next date after them.
  return cases
    .map(({ hearings, ...c }) => ({ ...c, nextHearing: hearings[0] ?? null }))
    .sort((a, b) => {
      if (a.nextHearing && b.nextHearing) {
        return a.nextHearing.scheduledAt.getTime() - b.nextHearing.scheduledAt.getTime();
      }
      return a.nextHearing ? -1 : b.nextHearing ? 1 : 0;
    });
}

export async function getCase(prisma: PrismaClient, lawyerId: string, id: string) {
  const legalCase = await prisma.case.findFirst({
    where: { id, lawyerId },
    include: {
      client: { select: { id: true, name: true, phone: true, email: true, hourlyRatePaise: true } },
      hearings: {
        orderBy: { scheduledAt: 'desc' },
        include: {
          reminders: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: { sendAt: 'asc' },
            select: {
              id: true,
              type: true,
              channel: true,
              sendAt: true,
              status: true,
              attempts: true,
              lastError: true,
              sentAt: true,
            },
          },
        },
      },
      timeEntries: { select: { minutes: true, amountPaise: true, invoiceId: true } },
    },
  });
  if (!legalCase) {
    throw new HttpError(404, NOT_FOUND);
  }

  const { timeEntries, ...rest } = legalCase;
  const time = { totalMinutes: 0, totalPaise: 0, unbilledMinutes: 0, unbilledPaise: 0 };
  for (const entry of timeEntries) {
    time.totalMinutes += entry.minutes;
    time.totalPaise += entry.amountPaise;
    if (!entry.invoiceId) {
      time.unbilledMinutes += entry.minutes;
      time.unbilledPaise += entry.amountPaise;
    }
  }
  return { ...rest, time };
}

export async function createCase(prisma: PrismaClient, lawyerId: string, body: CreateCaseBody) {
  const { firstHearing, ...fields } = body;
  try {
    return await prisma.$transaction(async (tx) => {
      await assertClientOwned(tx, lawyerId, fields.clientId);
      const legalCase = await tx.case.create({ data: { ...fields, lawyerId } });
      await scheduleHearing(tx, lawyerId, legalCase.id, firstHearing);
      return legalCase;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateCaseNumber();
    throw error;
  }
}

export async function updateCase(
  prisma: PrismaClient,
  lawyerId: string,
  id: string,
  body: UpdateCaseBody,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const owned = await tx.case.findFirst({ where: { id, lawyerId }, select: { id: true } });
      if (!owned) throw new HttpError(404, NOT_FOUND);
      await assertClientOwned(tx, lawyerId, body.clientId);
      const legalCase = await tx.case.update({ where: { id }, data: body });
      // Status and reminder overrides both change which reminders the hearings need.
      await syncUpcomingHearings(tx, { caseId: id });
      return legalCase;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateCaseNumber();
    throw error;
  }
}

export async function deleteCase(prisma: PrismaClient, lawyerId: string, id: string) {
  const legalCase = await prisma.case.findFirst({
    where: { id, lawyerId },
    select: { _count: { select: { timeEntries: true } } },
  });
  if (!legalCase) {
    throw new HttpError(404, NOT_FOUND);
  }
  if (legalCase._count.timeEntries > 0) {
    throw new HttpError(
      409,
      'This case has time entries, so it cannot be deleted. Close it instead to keep your billing history.',
    );
  }
  // Hearings and their reminders are deleted with the case.
  await prisma.case.delete({ where: { id } });
}
