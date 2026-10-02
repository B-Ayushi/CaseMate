import type { Case, Hearing, Lawyer, Prisma, ReminderChannel, ReminderType } from '@prisma/client';
import { istDateString, istDateTimeToUtc } from '../lib/time.js';

type Db = Prisma.TransactionClient;

const HOUR = 60 * 60 * 1000;

export const MISSING_OUTCOME_NUDGE_TIME = '18:00';

// When a hearing with no outcome is chased: 6:00 PM IST on the hearing day, or an hour
// after a hearing that runs later. Used for both the email nudge and the dashboard alert.
export function missingOutcomeNudgeAt(scheduledAt: Date): Date {
  const evening = istDateTimeToUtc(istDateString(scheduledAt), MISSING_OUTCOME_NUDGE_TIME);
  return new Date(Math.max(evening.getTime(), scheduledAt.getTime() + HOUR));
}

export interface PlannedReminder {
  type: ReminderType;
  channel: ReminderChannel;
  sendAt: Date;
}

type LawyerPrefs = Pick<
  Lawyer,
  | 'emailEnabled'
  | 'smsEnabled'
  | 'dayBeforeEnabled'
  | 'twoHourEnabled'
  | 'missingOutcomeNudgeEnabled'
>;

type CaseOverrides = Pick<
  Case,
  | 'status'
  | 'emailReminderOverride'
  | 'smsReminderOverride'
  | 'dayBeforeReminderOverride'
  | 'twoHourReminderOverride'
>;

// The settings that apply to one case: its own override where set, otherwise the
// lawyer's default.
export function effectiveSettings(lawyer: LawyerPrefs, legalCase: CaseOverrides) {
  return {
    email: legalCase.emailReminderOverride ?? lawyer.emailEnabled,
    sms: legalCase.smsReminderOverride ?? lawyer.smsEnabled,
    dayBefore: legalCase.dayBeforeReminderOverride ?? lawyer.dayBeforeEnabled,
    twoHour: legalCase.twoHourReminderOverride ?? lawyer.twoHourEnabled,
    missingOutcome: lawyer.missingOutcomeNudgeEnabled,
  };
}

// The reminders a hearing should have, following the rules in CLAUDE.md:
// - day-before: 24 hours before, by email and SMS
// - final: 2 hours before, by SMS
// - missing-outcome nudge: 6:00 PM IST on the hearing day (or an hour after a late
//   hearing), by email
// Hearings that are not scheduled, or belong to a closed case, get none.
export function planHearingReminders(
  hearing: Pick<Hearing, 'scheduledAt' | 'status'>,
  legalCase: CaseOverrides,
  lawyer: LawyerPrefs,
): PlannedReminder[] {
  if (hearing.status !== 'SCHEDULED' || legalCase.status !== 'ACTIVE') return [];

  const settings = effectiveSettings(lawyer, legalCase);
  const at = hearing.scheduledAt.getTime();
  const planned: PlannedReminder[] = [];

  if (settings.dayBefore) {
    const sendAt = new Date(at - 24 * HOUR);
    if (settings.email) planned.push({ type: 'DAY_BEFORE', channel: 'EMAIL', sendAt });
    if (settings.sms) planned.push({ type: 'DAY_BEFORE', channel: 'SMS', sendAt });
  }
  if (settings.twoHour && settings.sms) {
    planned.push({ type: 'TWO_HOUR', channel: 'SMS', sendAt: new Date(at - 2 * HOUR) });
  }
  if (settings.missingOutcome && settings.email) {
    planned.push({
      type: 'MISSING_OUTCOME',
      channel: 'EMAIL',
      sendAt: missingOutcomeNudgeAt(hearing.scheduledAt),
    });
  }

  return planned;
}

const sameReminder = (a: PlannedReminder, b: PlannedReminder) =>
  a.type === b.type && a.channel === b.channel && a.sendAt.getTime() === b.sendAt.getTime();

// Brings one hearing's reminders in line with its current date, status and settings.
// - Unsent (PENDING) reminders that no longer fit are CANCELLED. One that still fits is
//   kept even if it is already due, so the scheduler still sends it.
// - Missing ones whose time is still ahead are created. A matching CANCELLED row (the
//   date moved away and back) is reactivated rather than duplicated; the database's
//   unique key forbids copies.
// - SENT, SENDING and FAILED rows are never touched, so nothing is ever sent twice.
export async function syncHearingReminders(db: Db, hearingId: string, now: Date = new Date()) {
  const hearing = await db.hearing.findUniqueOrThrow({
    where: { id: hearingId },
    include: { case: true, lawyer: true, reminders: true },
  });

  const planned = planHearingReminders(hearing, hearing.case, hearing.lawyer);

  const stale = hearing.reminders.filter(
    (r) => r.status === 'PENDING' && !planned.some((p) => sameReminder(p, r)),
  );
  if (stale.length > 0) {
    await db.reminder.updateMany({
      where: { id: { in: stale.map((r) => r.id) }, status: 'PENDING' },
      data: { status: 'CANCELLED', nextAttemptAt: null },
    });
  }

  for (const wanted of planned) {
    if (wanted.sendAt.getTime() <= now.getTime()) continue;
    const existing = hearing.reminders.find((r) => sameReminder(wanted, r));
    if (!existing) {
      await db.reminder.create({
        data: { ...wanted, lawyerId: hearing.lawyerId, hearingId: hearing.id },
      });
    } else if (existing.status === 'CANCELLED') {
      await db.reminder.update({
        where: { id: existing.id },
        data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: null },
      });
    }
  }
}

// Re-plans the current hearings of a case (after its reminder overrides or status
// change), or of a lawyer (after their defaults change). Hearings from the last day are
// included because their evening missing-outcome nudge may still be pending.
export async function syncUpcomingHearings(
  db: Db,
  where: { caseId: string } | { lawyerId: string },
  now: Date = new Date(),
) {
  const hearings = await db.hearing.findMany({
    where: { ...where, scheduledAt: { gt: new Date(now.getTime() - 24 * HOUR) } },
    select: { id: true },
  });
  for (const { id } of hearings) {
    await syncHearingReminders(db, id, now);
  }
}
