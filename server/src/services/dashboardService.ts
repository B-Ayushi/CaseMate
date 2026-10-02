import type { PrismaClient } from '@prisma/client';
import { addDaysToIsoDay, istDateString, istDayRange } from '../lib/time.js';
import { hearingSummarySelect, visibleHearingWhere } from './hearingService.js';
import { describeFailure } from './reminderFailures.js';
import {
  failedReminderInclude,
  hasHearingLaterToday,
  lawyerReminderPrefsSelect,
  retryBlockedReason,
} from './reminderService.js';

const DAY = 24 * 60 * 60 * 1000;
export const UPCOMING_DAYS = 7;
// A failed reminder stays on the dashboard for this long after it failed.
const FAILED_SHOWN_FOR_MS = 7 * DAY;

// Everything the dashboard shows, for one lawyer. "Today" and the coming days are IST
// calendar days; their boundaries are converted to UTC instants for the queries.
// - today's hearings: every hearing today (scheduled or with its outcome logged)
// - next 7 days: scheduled hearings from tomorrow to 7 days ahead, counted per day
// - needs attention: hearings whose time has passed with no outcome logged, and
//   reminders that failed in the last 7 days
export async function getDashboard(prisma: PrismaClient, lawyerId: string, now = new Date()) {
  const today = istDateString(now);
  const todayRange = istDayRange(today);
  const upcomingFrom = todayRange.end;
  const upcomingTo = istDayRange(addDaysToIsoDay(today, UPCOMING_DAYS)).end;

  const [prefs, caseCount, todayHearings, upcoming, missingOutcome, failed, hearingLaterToday] =
    await Promise.all([
      prisma.lawyer.findUniqueOrThrow({
        where: { id: lawyerId },
        select: lawyerReminderPrefsSelect,
      }),
      prisma.case.count({ where: { lawyerId } }),
      prisma.hearing.findMany({
        where: {
          lawyerId,
          ...visibleHearingWhere,
          scheduledAt: { gte: todayRange.start, lt: todayRange.end },
        },
        orderBy: { scheduledAt: 'asc' },
        select: hearingSummarySelect,
      }),
      prisma.hearing.findMany({
        where: {
          lawyerId,
          status: 'SCHEDULED',
          case: { status: 'ACTIVE' },
          scheduledAt: { gte: upcomingFrom, lt: upcomingTo },
        },
        select: { scheduledAt: true },
      }),
      prisma.hearing.findMany({
        where: {
          lawyerId,
          status: 'SCHEDULED',
          case: { status: 'ACTIVE' },
          scheduledAt: { lt: now },
        },
        orderBy: { scheduledAt: 'asc' },
        select: hearingSummarySelect,
      }),
      prisma.reminder.findMany({
        where: {
          lawyerId,
          status: 'FAILED',
          updatedAt: { gte: new Date(now.getTime() - FAILED_SHOWN_FOR_MS) },
        },
        orderBy: { updatedAt: 'desc' },
        include: failedReminderInclude,
      }),
      hasHearingLaterToday(prisma, lawyerId, now),
    ]);

  const days = Array.from({ length: UPCOMING_DAYS }, (_, i) => {
    const date = addDaysToIsoDay(today, i + 1);
    return { date, count: upcoming.filter((h) => istDateString(h.scheduledAt) === date).length };
  });

  const failedReminders = failed.map((r) => {
    const blocked = retryBlockedReason(r, { prefs, now, hearingLaterToday });
    return {
      id: r.id,
      type: r.type,
      channel: r.channel,
      failedAt: r.updatedAt,
      reason: describeFailure(r.channel, r.lastError),
      detail: r.lastError,
      summaryDate: r.summaryDate ? r.summaryDate.toISOString().slice(0, 10) : null,
      hearing: r.hearing ? { id: r.hearing.id, scheduledAt: r.hearing.scheduledAt } : null,
      case: r.hearing
        ? {
            id: r.hearing.case.id,
            title: r.hearing.case.title,
            caseNumber: r.hearing.case.caseNumber,
          }
        : null,
      canRetry: blocked === null,
      retryBlockedReason: blocked,
    };
  });

  return {
    today,
    hasCases: caseCount > 0,
    counts: {
      today: todayHearings.length,
      next7Days: upcoming.length,
      needNextDate: missingOutcome.length,
    },
    todayHearings,
    next7Days: { total: upcoming.length, days },
    needsAttention: { missingOutcome, failedReminders },
  };
}
