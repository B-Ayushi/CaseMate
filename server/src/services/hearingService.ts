import type { HearingOutcome, Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import {
  dateOnly,
  formatIst,
  istDateString,
  istDateTimeToUtc,
  istDayRange,
  monthDays,
} from '../lib/time.js';
import type { HearingSlot, OutcomeBody } from '../validators/caseValidators.js';
import { missingOutcomeNudgeAt, syncHearingReminders } from './reminderPlanner.js';

type Db = Prisma.TransactionClient;

const NOT_FOUND = 'Hearing not found.';

export const outcomeLabels: Record<HearingOutcome, string> = {
  ADJOURNED: 'Adjourned',
  HEARD: 'Heard',
  ORDER_RESERVED: 'Order reserved',
  DISPOSED: 'Disposed',
  OTHER: 'Other',
};

// The UTC instant of a hearing slot, which must be in the future.
function futureInstant(slot: Pick<HearingSlot, 'date' | 'time'>, field: string, now: Date) {
  const scheduledAt = istDateTimeToUtc(slot.date, slot.time);
  if (scheduledAt.getTime() <= now.getTime()) {
    throw new HttpError(400, 'The hearing date and time must be in the future.', {
      [`${field}.date`]: 'Choose a date and time in the future',
    });
  }
  return scheduledAt;
}

async function findOwnedHearing(db: Db, lawyerId: string, id: string) {
  const hearing = await db.hearing.findFirst({ where: { id, lawyerId }, include: { case: true } });
  if (!hearing) throw new HttpError(404, NOT_FOUND);
  return hearing;
}

export async function scheduleHearing(
  db: Db,
  lawyerId: string,
  caseId: string,
  slot: HearingSlot,
  field = 'firstHearing',
  now = new Date(),
) {
  const legalCase = await db.case.findFirst({ where: { id: caseId, lawyerId } });
  if (!legalCase) throw new HttpError(404, 'Case not found.');
  if (legalCase.status === 'CLOSED') {
    throw new HttpError(409, 'This case is closed. Reopen it before adding a hearing.');
  }

  const hearing = await db.hearing.create({
    data: {
      lawyerId,
      caseId,
      scheduledAt: futureInstant(slot, field, now),
      purpose: slot.purpose,
      notes: slot.notes,
    },
  });
  await syncHearingReminders(db, hearing.id, now);
  return hearing;
}

export function addHearing(
  prisma: PrismaClient,
  lawyerId: string,
  caseId: string,
  slot: HearingSlot,
) {
  return prisma.$transaction((tx) => scheduleHearing(tx, lawyerId, caseId, slot, 'hearing'));
}

// Moves a scheduled hearing or changes its details. Reminders for the old time are
// cancelled and new ones created.
export function updateHearing(
  prisma: PrismaClient,
  lawyerId: string,
  id: string,
  slot: HearingSlot,
) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const hearing = await findOwnedHearing(tx, lawyerId, id);
    if (hearing.status !== 'SCHEDULED') {
      throw new HttpError(409, 'Only a scheduled hearing can be changed.');
    }
    const scheduledAt = istDateTimeToUtc(slot.date, slot.time);
    // Keeping the same time is fine even once it has passed (to fix a typo in the notes).
    if (scheduledAt.getTime() !== hearing.scheduledAt.getTime()) {
      futureInstant(slot, 'hearing', now);
    }
    const updated = await tx.hearing.update({
      where: { id },
      data: { scheduledAt, purpose: slot.purpose, notes: slot.notes },
    });
    await syncHearingReminders(tx, id, now);
    return updated;
  });
}

export function cancelHearing(prisma: PrismaClient, lawyerId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const hearing = await findOwnedHearing(tx, lawyerId, id);
    if (hearing.status !== 'SCHEDULED') {
      throw new HttpError(409, 'Only a scheduled hearing can be cancelled.');
    }
    const updated = await tx.hearing.update({ where: { id }, data: { status: 'CANCELLED' } });
    await syncHearingReminders(tx, id);
    return updated;
  });
}

// Records what happened at a hearing. In one transaction it:
// - marks the hearing completed with its outcome,
// - adds the time spent as a billable time entry at the client's (or default) rate,
// - schedules the next hearing with fresh reminders, if a next date is given,
// - closes the case if asked.
export function logOutcome(prisma: PrismaClient, lawyerId: string, id: string, body: OutcomeBody) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const hearing = await findOwnedHearing(tx, lawyerId, id);
    if (hearing.status !== 'SCHEDULED') {
      throw new HttpError(409, 'The outcome of this hearing has already been recorded.');
    }
    if (istDateString(hearing.scheduledAt) > istDateString(now)) {
      throw new HttpError(409, 'You can record the outcome on the day of the hearing or later.');
    }

    if (body.nextHearing) {
      const next = istDateTimeToUtc(body.nextHearing.date, body.nextHearing.time);
      if (next.getTime() <= hearing.scheduledAt.getTime()) {
        throw new HttpError(400, 'The next date must be after this hearing.', {
          'nextHearing.date': 'Choose a date after this hearing',
        });
      }
    }

    const completed = await tx.hearing.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        outcome: body.outcome,
        outcomeNotes: body.outcomeNotes,
        timeSpentMinutes: body.timeSpentMinutes,
        loggedAt: now,
      },
    });
    await syncHearingReminders(tx, id, now);

    let timeEntry = null;
    if (body.timeSpentMinutes && body.timeSpentMinutes > 0) {
      const [lawyer, client] = await Promise.all([
        tx.lawyer.findUniqueOrThrow({ where: { id: lawyerId } }),
        tx.client.findUniqueOrThrow({ where: { id: hearing.case.clientId } }),
      ]);
      const ratePaise = client.hourlyRatePaise ?? lawyer.defaultHourlyRatePaise;
      timeEntry = await tx.timeEntry.create({
        data: {
          lawyerId,
          caseId: hearing.caseId,
          hearingId: id,
          workDate: dateOnly(istDateString(hearing.scheduledAt)),
          minutes: body.timeSpentMinutes,
          description: `Hearing: ${outcomeLabels[body.outcome]}${hearing.purpose ? ` (${hearing.purpose})` : ''}`,
          ratePaise,
          amountPaise: Math.round((body.timeSpentMinutes * ratePaise) / 60),
        },
      });
    }

    let nextHearing = null;
    if (body.nextHearing) {
      nextHearing = await scheduleHearing(
        tx,
        lawyerId,
        hearing.caseId,
        body.nextHearing,
        'nextHearing',
        now,
      );
    }

    if (body.closeCase) {
      await tx.case.update({ where: { id: hearing.caseId }, data: { status: 'CLOSED' } });
    } else {
      // Touch the case so it sorts as recently active.
      await tx.case.update({ where: { id: hearing.caseId }, data: { updatedAt: now } });
    }

    return { hearing: completed, nextHearing, timeEntry };
  });
}

// Hearings shown on the dashboard and calendar: ones that took place (outcome logged),
// and scheduled ones of open cases. Cancelled hearings, and scheduled hearings left on a
// case that has since been closed, are not shown.
export const visibleHearingWhere = {
  OR: [{ status: 'COMPLETED' }, { status: 'SCHEDULED', case: { status: 'ACTIVE' } }],
} satisfies Prisma.HearingWhereInput;

export const hearingSummarySelect = {
  id: true,
  scheduledAt: true,
  purpose: true,
  status: true,
  outcome: true,
  case: {
    select: {
      id: true,
      title: true,
      caseNumber: true,
      courtName: true,
      courtroom: true,
      client: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.HearingSelect;

// Hearings in an IST date range, in time order.
export async function listHearings(
  prisma: PrismaClient,
  lawyerId: string,
  range: { from: string; to: string },
) {
  return prisma.hearing.findMany({
    where: {
      lawyerId,
      ...visibleHearingWhere,
      scheduledAt: { gte: istDayRange(range.from).start, lt: istDayRange(range.to).end },
    },
    orderBy: { scheduledAt: 'asc' },
    select: hearingSummarySelect,
  });
}

// One calendar month ("yyyy-MM") of hearings. The month starts at midnight IST on its
// first day and ends at midnight IST after its last day. Each hearing carries its IST
// date and time as well as the UTC instant.
export async function calendarMonth(prisma: PrismaClient, lawyerId: string, month: string) {
  const { first, last } = monthDays(month);
  const hearings = await listHearings(prisma, lawyerId, { from: first, to: last });
  return hearings.map((h) => ({
    ...h,
    date: istDateString(h.scheduledAt),
    time: formatIst(h.scheduledAt, 'HH:mm'),
  }));
}

// Scheduled hearings of active cases that are past their alert time with no outcome.
export async function hearingsMissingOutcome(
  prisma: PrismaClient,
  lawyerId: string,
  now = new Date(),
) {
  const candidates = await prisma.hearing.findMany({
    where: { lawyerId, status: 'SCHEDULED', scheduledAt: { lt: now }, case: { status: 'ACTIVE' } },
    orderBy: { scheduledAt: 'asc' },
    select: {
      id: true,
      scheduledAt: true,
      purpose: true,
      case: { select: { id: true, title: true, caseNumber: true, courtName: true } },
    },
  });
  return candidates.filter((h) => missingOutcomeNudgeAt(h.scheduledAt) <= now);
}
