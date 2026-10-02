import type { Lawyer, Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import { istDateString, istDayRange } from '../lib/time.js';
import { reasonReminderNoLongerApplies } from './reminderPlanner.js';

export const lawyerReminderPrefsSelect = {
  emailEnabled: true,
  smsEnabled: true,
  dayBeforeEnabled: true,
  twoHourEnabled: true,
  missingOutcomeNudgeEnabled: true,
} satisfies Prisma.LawyerSelect;

type LawyerReminderPrefs = Pick<Lawyer, keyof typeof lawyerReminderPrefsSelect>;

export const failedReminderInclude = {
  hearing: {
    include: {
      case: {
        select: {
          id: true,
          title: true,
          caseNumber: true,
          status: true,
          emailReminderOverride: true,
          smsReminderOverride: true,
          dayBeforeReminderOverride: true,
          twoHourReminderOverride: true,
        },
      },
    },
  },
} satisfies Prisma.ReminderInclude;

export type FailedReminder = Prisma.ReminderGetPayload<{ include: typeof failedReminderInclude }>;

// Whether the lawyer still has a scheduled hearing later today (IST), which is what a
// retried daily summary would list.
export function hasHearingLaterToday(prisma: PrismaClient, lawyerId: string, now: Date) {
  return prisma.hearing
    .count({
      where: {
        lawyerId,
        status: 'SCHEDULED',
        case: { status: 'ACTIVE' },
        scheduledAt: { gt: now, lt: istDayRange(istDateString(now)).end },
      },
    })
    .then((count) => count > 0);
}

// Why a failed reminder cannot be sent again now, or null if it can. A hearing reminder
// can be retried only while its hearing is still scheduled, in the future, and at the
// time the reminder was planned for. A daily summary can be retried on its own day while
// a hearing is still ahead.
export function retryBlockedReason(
  reminder: FailedReminder,
  context: { prefs: LawyerReminderPrefs; now: Date; hearingLaterToday: boolean },
): string | null {
  if (reminder.type === 'DAILY_SUMMARY') {
    const day = reminder.summaryDate?.toISOString().slice(0, 10);
    if (day !== istDateString(context.now)) return 'This daily summary was for an earlier day.';
    if (!context.hearingLaterToday) return 'No hearings are left today to summarise.';
    return null;
  }

  const hearing = reminder.hearing;
  if (!hearing) return 'The hearing no longer exists.';
  const reason = reasonReminderNoLongerApplies(reminder, { ...hearing, lawyer: context.prefs });
  if (reason) return reason;
  if (hearing.scheduledAt <= context.now) return 'The hearing has already taken place.';
  return null;
}

// Puts a FAILED reminder back in the queue with a fresh set of attempts. Its send time
// has passed, so the next scheduler run (within 5 minutes) sends it.
export async function retryReminder(
  prisma: PrismaClient,
  lawyerId: string,
  id: string,
  now = new Date(),
) {
  const reminder = await prisma.reminder.findFirst({
    where: { id, lawyerId },
    include: failedReminderInclude,
  });
  if (!reminder) throw new HttpError(404, 'Reminder not found.');
  if (reminder.status !== 'FAILED') {
    throw new HttpError(409, 'Only a reminder that failed can be retried.');
  }

  const [prefs, hearingLaterToday] = await Promise.all([
    prisma.lawyer.findUniqueOrThrow({ where: { id: lawyerId }, select: lawyerReminderPrefsSelect }),
    hasHearingLaterToday(prisma, lawyerId, now),
  ]);
  const blocked = retryBlockedReason(reminder, { prefs, now, hearingLaterToday });
  if (blocked) throw new HttpError(409, `This reminder can't be sent again. ${blocked}`);

  // Conditional on FAILED, so two clicks (or two tabs) put it back only once.
  const { count } = await prisma.reminder.updateMany({
    where: { id, lawyerId, status: 'FAILED' },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: null, lastError: null },
  });
  if (count !== 1) throw new HttpError(409, 'Only a reminder that failed can be retried.');

  return prisma.reminder.findUniqueOrThrow({
    where: { id },
    select: { id: true, status: true, attempts: true, sendAt: true },
  });
}
