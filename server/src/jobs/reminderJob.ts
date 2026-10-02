import { Prisma, type PrismaClient, type Reminder } from '@prisma/client';
import type { Mailer } from '../lib/mailer.js';
import { sendSms, type SmsProvider } from '../lib/sms.js';
import { dateOnly, formatIst, istDateString, istDateTimeToUtc, istDayRange } from '../lib/time.js';
import {
  dailySummaryEmail,
  dayBeforeEmail,
  dayBeforeSms,
  missingOutcomeEmail,
  twoHourSms,
  type HearingInfo,
} from '../services/emails/reminderMessages.js';
import { planHearingReminders } from '../services/reminderPlanner.js';

// A failed send is retried 3 times, 5, 10 and then 15 minutes after the previous try.
// If the third retry also fails the reminder is marked FAILED (4 attempts in all).
export const RETRY_DELAYS_MINUTES = [5, 10, 15] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
const BATCH_SIZE = 100;
// A reminder left in SENDING this long was interrupted (for example by a restart).
const STUCK_AFTER_MS = 10 * 60 * 1000;

export interface ReminderJobDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  sms: SmsProvider;
  clientUrl: string;
}

export interface CycleResult {
  summariesCreated: number;
  // Reminders this run took for sending. Each ends up sent, retrying, failed or cancelled.
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  cancelled: number;
}

const hearingInclude = {
  lawyer: {
    select: {
      email: true,
      phone: true,
      emailEnabled: true,
      smsEnabled: true,
      dayBeforeEnabled: true,
      twoHourEnabled: true,
      missingOutcomeNudgeEnabled: true,
    },
  },
  case: {
    select: {
      id: true,
      title: true,
      caseNumber: true,
      courtName: true,
      courtroom: true,
      status: true,
      emailReminderOverride: true,
      smsReminderOverride: true,
      dayBeforeReminderOverride: true,
      twoHourReminderOverride: true,
      client: { select: { name: true } },
    },
  },
} satisfies Prisma.HearingInclude;

type HearingForReminder = Prisma.HearingGetPayload<{ include: typeof hearingInclude }>;

// Creates today's daily summary for every lawyer whose summary time has come and who
// has at least one hearing still ahead today. The unique key (lawyer, type, channel,
// summaryDate) means a summary can only ever be created once per IST day, however many
// runs or server processes try.
async function createDueDailySummaries(prisma: PrismaClient, now: Date): Promise<number> {
  const today = istDateString(now);
  const { end } = istDayRange(today);

  const hearingsAhead = await prisma.hearing.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { gt: now, lt: end },
      case: { status: 'ACTIVE' },
      lawyer: { dailySummaryEnabled: true, emailEnabled: true },
    },
    distinct: ['lawyerId'],
    select: { lawyer: { select: { id: true, dailySummaryTime: true } } },
  });

  let created = 0;
  for (const { lawyer } of hearingsAhead) {
    const sendAt = istDateTimeToUtc(today, lawyer.dailySummaryTime);
    if (sendAt > now) continue;
    try {
      await prisma.reminder.create({
        data: {
          lawyerId: lawyer.id,
          type: 'DAILY_SUMMARY',
          channel: 'EMAIL',
          summaryDate: dateOnly(today),
          sendAt,
        },
      });
      created += 1;
    } catch (error) {
      // Already created today (by an earlier run or another server process).
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
  }
  return created;
}

// Reminders stuck in SENDING were interrupted mid-send. They may or may not have been
// delivered, so they are never sent again: they are marked FAILED for the lawyer to see.
// This uses the real clock, since it is about how long a send has been in progress.
async function failInterruptedSends(prisma: PrismaClient) {
  await prisma.reminder.updateMany({
    where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: {
      status: 'FAILED',
      lastError:
        'Sending was interrupted (the server stopped). It was not retried in case it had already arrived.',
    },
  });
}

// Claims a due reminder for this run by moving it from PENDING to SENDING in a single
// UPDATE. The row must still be due and still have the attempt count this run read, so
// when two runs or two servers race for the same reminder, MySQL lets exactly one UPDATE
// match and the others see 0 affected rows and leave it alone. Only the run that claimed
// a reminder sends it.
export async function claimReminder(
  prisma: PrismaClient,
  reminder: Pick<Reminder, 'id' | 'attempts'>,
  now: Date,
): Promise<boolean> {
  const affected = await prisma.$executeRaw`
    UPDATE reminders
    SET status = 'SENDING', updatedAt = ${new Date()}
    WHERE id = ${reminder.id}
      AND status = 'PENDING'
      AND attempts = ${reminder.attempts}
      AND sendAt <= ${now}
      AND (nextAttemptAt IS NULL OR nextAttemptAt <= ${now})`;
  return affected === 1;
}

// Why a hearing reminder must not go out after all, or null if it still should. The
// hearing is read again just before sending, so a move, cancellation, logged outcome or
// settings change made after the reminder was planned is always respected.
function reasonNotToSend(
  reminder: Reminder,
  hearing: HearingForReminder,
  now: Date,
): string | null {
  if (hearing.status === 'COMPLETED') return 'The outcome of the hearing has been logged.';
  if (hearing.status === 'CANCELLED') return 'The hearing was cancelled.';
  if (hearing.case.status !== 'ACTIVE') return 'The case is closed.';

  const planned = planHearingReminders(hearing, hearing.case, hearing.lawyer).find(
    (p) => p.type === reminder.type && p.channel === reminder.channel,
  );
  if (!planned) return 'This reminder was turned off in Settings or for this case.';
  if (planned.sendAt.getTime() !== reminder.sendAt.getTime()) {
    return `The hearing was moved to ${formatIst(hearing.scheduledAt, 'd MMM yyyy, h:mm a')} IST.`;
  }
  // A hearing reminder that would arrive after the hearing has started is no use.
  if (reminder.type !== 'MISSING_OUTCOME' && hearing.scheduledAt <= now) {
    return 'The hearing had already started when this was due.';
  }
  return null;
}

type Outcome = { kind: 'sent' } | { kind: 'cancelled'; reason: string };

async function deliverDailySummary(deps: ReminderJobDeps, reminder: Reminder): Promise<Outcome> {
  const { prisma, mailer, clientUrl } = deps;
  const lawyer = await prisma.lawyer.findUniqueOrThrow({
    where: { id: reminder.lawyerId },
    select: { email: true, emailEnabled: true, dailySummaryEnabled: true },
  });
  if (!lawyer.dailySummaryEnabled || !lawyer.emailEnabled) {
    return { kind: 'cancelled', reason: 'The daily summary was turned off in Settings.' };
  }

  const day = istDateString(reminder.sendAt);
  const { start, end } = istDayRange(day);
  const hearings: HearingInfo[] = await prisma.hearing.findMany({
    where: {
      lawyerId: reminder.lawyerId,
      status: 'SCHEDULED',
      scheduledAt: { gte: start, lt: end },
      case: { status: 'ACTIVE' },
    },
    orderBy: { scheduledAt: 'asc' },
    include: hearingInclude,
  });
  if (hearings.length === 0) {
    return { kind: 'cancelled', reason: 'No hearings left today.' };
  }
  await mailer.send(dailySummaryEmail(lawyer.email, start, hearings, clientUrl));
  return { kind: 'sent' };
}

async function deliver(deps: ReminderJobDeps, reminder: Reminder, now: Date): Promise<Outcome> {
  if (reminder.type === 'DAILY_SUMMARY') return deliverDailySummary(deps, reminder);

  const { prisma, mailer, sms, clientUrl } = deps;
  const hearing = reminder.hearingId
    ? await prisma.hearing.findUnique({
        where: { id: reminder.hearingId },
        include: hearingInclude,
      })
    : null;
  if (!hearing) return { kind: 'cancelled', reason: 'The hearing no longer exists.' };
  const reason = reasonNotToSend(reminder, hearing, now);
  if (reason) return { kind: 'cancelled', reason };

  const { email, phone } = hearing.lawyer;
  if (reminder.type === 'MISSING_OUTCOME') {
    await mailer.send(missingOutcomeEmail(email, hearing, clientUrl));
  } else if (reminder.type === 'DAY_BEFORE' && reminder.channel === 'EMAIL') {
    await mailer.send(dayBeforeEmail(email, hearing, clientUrl));
  } else if (reminder.type === 'DAY_BEFORE') {
    await sendSms(sms, phone, dayBeforeSms(hearing));
  } else {
    await sendSms(sms, phone, twoHourSms(hearing));
  }
  return { kind: 'sent' };
}

// One run of the reminder engine: create due daily summaries, then claim and send every
// reminder that is due. The 5-minute cron job and `npm run reminders:tick` both call this.
export async function runReminderCycle(
  deps: ReminderJobDeps,
  now: Date = new Date(),
): Promise<CycleResult> {
  const { prisma } = deps;
  const result: CycleResult = {
    summariesCreated: 0,
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    cancelled: 0,
  };

  await failInterruptedSends(prisma);
  result.summariesCreated = await createDueDailySummaries(prisma, now);

  const due = await prisma.reminder.findMany({
    where: {
      status: 'PENDING',
      sendAt: { lte: now },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { sendAt: 'asc' },
    take: BATCH_SIZE,
  });

  for (const reminder of due) {
    if (!(await claimReminder(prisma, reminder, now))) continue;
    result.claimed += 1;

    const attempts = reminder.attempts + 1;
    try {
      const outcome = await deliver(deps, reminder, now);
      if (outcome.kind === 'sent') {
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            attempts,
            lastError: null,
            nextAttemptAt: null,
          },
        });
        result.sent += 1;
      } else {
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { status: 'CANCELLED', lastError: outcome.reason, nextAttemptAt: null },
        });
        result.cancelled += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const giveUp = attempts >= MAX_ATTEMPTS;
      const delayMinutes = RETRY_DELAYS_MINUTES[attempts - 1] ?? 0;
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: {
          status: giveUp ? 'FAILED' : 'PENDING',
          attempts,
          lastError: message.slice(0, 1000),
          nextAttemptAt: giveUp ? null : new Date(now.getTime() + delayMinutes * 60 * 1000),
        },
      });
      if (giveUp) result.failed += 1;
      else result.retrying += 1;
    }
  }

  return result;
}
