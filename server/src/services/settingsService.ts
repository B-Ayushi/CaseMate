import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import type { Mailer } from '../lib/mailer.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { sendSms, type SmsProvider } from '../lib/sms.js';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  ProfileInput,
  ReminderPrefsInput,
} from '../validators/settingsValidators.js';
import { publicLawyerSelect } from './authService.js';
import { testReminderEmail, testReminderSms } from './emails/reminderMessages.js';
import { describeFailure } from './reminderFailures.js';
import { rebuildLawyerReminders } from './reminderService.js';

export const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  barCouncilNumber: true,
} as const;

export const reminderPrefsSelect = {
  emailEnabled: true,
  smsEnabled: true,
  dayBeforeEnabled: true,
  twoHourEnabled: true,
  dailySummaryEnabled: true,
  dailySummaryTime: true,
  missingOutcomeNudgeEnabled: true,
} as const;

export function getProfile(prisma: PrismaClient, lawyerId: string) {
  return prisma.lawyer.findUniqueOrThrow({ where: { id: lawyerId }, select: profileSelect });
}

export function updateProfile(prisma: PrismaClient, lawyerId: string, input: ProfileInput) {
  return prisma.lawyer.update({ where: { id: lawyerId }, data: input, select: profileSelect });
}

async function checkPassword(
  prisma: PrismaClient,
  lawyerId: string,
  password: string,
  field: string,
) {
  const { passwordHash } = await prisma.lawyer.findUniqueOrThrow({
    where: { id: lawyerId },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(password, passwordHash))) {
    throw new HttpError(400, 'Your current password is not correct.', {
      [field]: 'This is not your current password',
    });
  }
  return passwordHash;
}

// Changes the password. The caller then re-issues this session; every other session was
// tied to the old password and stops working (see lib/session.ts).
export async function changePassword(
  prisma: PrismaClient,
  lawyerId: string,
  input: ChangePasswordInput,
) {
  await checkPassword(prisma, lawyerId, input.currentPassword, 'currentPassword');
  if (input.currentPassword === input.newPassword) {
    throw new HttpError(400, 'Choose a new password that is different from the current one.', {
      newPassword: 'Choose a password different from your current one',
    });
  }
  await prisma.lawyer.update({
    where: { id: lawyerId },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    },
  });
}

export function getReminderPrefs(prisma: PrismaClient, lawyerId: string) {
  return prisma.lawyer.findUniqueOrThrow({ where: { id: lawyerId }, select: reminderPrefsSelect });
}

// Saves the preferences and, in the same transaction, rebuilds the pending reminders of
// every current hearing to match them.
export function updateReminderPrefs(
  prisma: PrismaClient,
  lawyerId: string,
  input: ReminderPrefsInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const preferences = await tx.lawyer.update({
        where: { id: lawyerId },
        data: input,
        select: reminderPrefsSelect,
      });
      const upcomingHearings = await rebuildLawyerReminders(tx, lawyerId);
      return { preferences, upcomingHearings };
    },
    { timeout: 60_000 },
  );
}

// The default hourly rate, used for time on cases whose client has no rate of their own.
// Changing it affects only time logged afterwards: every entry keeps the rate it was
// created with.
export function getBillingSettings(prisma: PrismaClient, lawyerId: string) {
  return prisma.lawyer.findUniqueOrThrow({
    where: { id: lawyerId },
    select: { defaultHourlyRatePaise: true },
  });
}

export function updateBillingSettings(
  prisma: PrismaClient,
  lawyerId: string,
  input: { defaultHourlyRatePaise: number },
) {
  return prisma.lawyer.update({
    where: { id: lawyerId },
    data: input,
    select: { defaultHourlyRatePaise: true },
  });
}

export type TestResult =
  { status: 'sent'; to: string } | { status: 'failed'; to: string; reason: string };

// Sends one email and one SMS to the lawyer straight away, through the same mailer and
// SMS provider as real reminders, and reports each result on its own.
export async function sendTestReminder(
  deps: { prisma: PrismaClient; mailer: Mailer; sms: SmsProvider; clientUrl: string },
  lawyerId: string,
): Promise<{ email: TestResult; sms: TestResult }> {
  const lawyer = await deps.prisma.lawyer.findUniqueOrThrow({
    where: { id: lawyerId },
    select: { name: true, email: true, phone: true },
  });

  const attempt = async (
    channel: 'EMAIL' | 'SMS',
    to: string,
    send: () => Promise<void>,
  ): Promise<TestResult> => {
    try {
      await send();
      return { status: 'sent', to };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Test ${channel.toLowerCase()} to ${to} failed:`, message);
      return { status: 'failed', to, reason: describeFailure(channel, message) };
    }
  };

  const [email, sms] = await Promise.all([
    attempt('EMAIL', lawyer.email, () =>
      deps.mailer.send(testReminderEmail(lawyer.email, lawyer.name, deps.clientUrl)),
    ),
    attempt('SMS', lawyer.phone, () => sendSms(deps.sms, lawyer.phone, testReminderSms())),
  ]);
  return { email, sms };
}

// Everything the lawyer owns, as plain data. Secrets (password and reset token hashes)
// are never included.
export async function exportData(prisma: PrismaClient, lawyerId: string) {
  const where = { lawyerId };
  const [profile, clients, clientNotes, cases, hearings, reminders, timeEntries, invoices] =
    await Promise.all([
      prisma.lawyer.findUniqueOrThrow({ where: { id: lawyerId }, select: publicLawyerSelect }),
      prisma.client.findMany({ where, orderBy: { createdAt: 'asc' } }),
      prisma.clientNote.findMany({ where, orderBy: { notedAt: 'asc' } }),
      prisma.case.findMany({ where, orderBy: { createdAt: 'asc' } }),
      prisma.hearing.findMany({ where, orderBy: { scheduledAt: 'asc' } }),
      prisma.reminder.findMany({ where, orderBy: { sendAt: 'asc' } }),
      prisma.timeEntry.findMany({ where, orderBy: { workDate: 'asc' } }),
      prisma.invoice.findMany({ where, orderBy: { issueDate: 'asc' } }),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    notes:
      'CaseMate data export. Times are UTC (ISO 8601); amounts are in paise (1 rupee = 100 paise).',
    profile,
    clients,
    clientNotes,
    cases,
    hearings,
    reminders,
    timeEntries,
    invoices,
  };
}

// Deletes the account and everything in it, in one transaction, after checking the
// typed email and the password. Children go first because the rules that protect
// billing history (Restrict on cases, clients and time entries) would otherwise block it.
export async function deleteAccount(
  prisma: PrismaClient,
  lawyerId: string,
  input: DeleteAccountInput,
) {
  const { email } = await prisma.lawyer.findUniqueOrThrow({
    where: { id: lawyerId },
    select: { email: true },
  });
  if (input.email !== email.toLowerCase()) {
    throw new HttpError(400, 'The email you typed does not match your account.', {
      email: 'Type the email address you log in with',
    });
  }
  await checkPassword(prisma, lawyerId, input.password, 'password');

  await prisma.$transaction(async (tx) => {
    const where = { lawyerId };
    await tx.timeEntry.deleteMany({ where });
    await tx.invoice.deleteMany({ where });
    await tx.reminder.deleteMany({ where });
    await tx.hearing.deleteMany({ where });
    await tx.case.deleteMany({ where });
    await tx.clientNote.deleteMany({ where });
    await tx.client.deleteMany({ where });
    await tx.lawyer.delete({ where: { id: lawyerId } });
  });
}
