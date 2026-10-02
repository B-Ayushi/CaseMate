import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import type { Mailer } from '../lib/mailer.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import type { LoginInput, ResetPasswordInput, SignupInput } from '../validators/authValidators.js';
import { passwordResetEmail } from './emails/passwordResetEmail.js';

export const RESET_TOKEN_TTL_MINUTES = 30;

// The only lawyer fields that ever leave the server. Secrets (password and reset token
// hashes) are never selected.
export const publicLawyerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  barCouncilNumber: true,
  defaultHourlyRatePaise: true,
  emailEnabled: true,
  smsEnabled: true,
  dayBeforeEnabled: true,
  twoHourEnabled: true,
  dailySummaryEnabled: true,
  dailySummaryTime: true,
  missingOutcomeNudgeEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LawyerSelect;

export type PublicLawyer = Prisma.LawyerGetPayload<{ select: typeof publicLawyerSelect }>;

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const DUPLICATE_EMAIL = 'An account with this email already exists. Try logging in instead.';

export async function signup(prisma: PrismaClient, input: SignupInput): Promise<PublicLawyer> {
  const existing = await prisma.lawyer.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw new HttpError(409, DUPLICATE_EMAIL);
  }

  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.lawyer.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        barCouncilNumber: input.barCouncilNumber,
        passwordHash,
      },
      select: publicLawyerSelect,
    });
  } catch (error) {
    // Two signups for the same email at the same moment: the unique key decides.
    if (isUniqueViolation(error)) {
      throw new HttpError(409, DUPLICATE_EMAIL);
    }
    throw error;
  }
}

export async function login(prisma: PrismaClient, input: LoginInput): Promise<PublicLawyer> {
  const lawyer = await prisma.lawyer.findUnique({
    where: { email: input.email },
    select: { ...publicLawyerSelect, passwordHash: true },
  });

  const ok = await verifyPassword(input.password, lawyer?.passwordHash ?? null);
  if (!lawyer || !ok) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }

  const { passwordHash: _passwordHash, ...publicFields } = lawyer;
  return publicFields;
}

export async function getLawyer(prisma: PrismaClient, lawyerId: string) {
  return prisma.lawyer.findUnique({ where: { id: lawyerId }, select: publicLawyerSelect });
}

// Creates a reset token and emails it if the account exists. Does nothing otherwise.
// The caller responds before this runs, so the response never reveals which happened.
export async function requestPasswordReset(
  prisma: PrismaClient,
  mailer: Mailer,
  clientUrl: string,
  email: string,
): Promise<void> {
  const lawyer = await prisma.lawyer.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });
  if (!lawyer) {
    return;
  }

  const token = randomBytes(32).toString('base64url');
  await prisma.lawyer.update({
    where: { id: lawyer.id },
    data: {
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
    },
  });

  const resetUrl = new URL('/reset-password', clientUrl);
  resetUrl.searchParams.set('token', token);

  await mailer.send(
    passwordResetEmail({
      to: lawyer.email,
      name: lawyer.name,
      resetUrl: resetUrl.toString(),
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    }),
  );
}

const INVALID_RESET = 'This reset link is invalid or has expired. Please request a new one.';

export async function resetPassword(
  prisma: PrismaClient,
  input: ResetPasswordInput,
): Promise<void> {
  const tokenHash = hashResetToken(input.token);
  const lawyer = await prisma.lawyer.findUnique({
    where: { passwordResetTokenHash: tokenHash },
    select: { id: true, passwordResetExpiresAt: true },
  });
  if (!lawyer?.passwordResetExpiresAt || lawyer.passwordResetExpiresAt <= new Date()) {
    throw new HttpError(400, INVALID_RESET);
  }

  const passwordHash = await hashPassword(input.password);

  // Matching on the token hash as well makes the token single-use even if two resets
  // with the same link arrive at once.
  const { count } = await prisma.lawyer.updateMany({
    where: { id: lawyer.id, passwordResetTokenHash: tokenHash },
    data: { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null },
  });
  if (count !== 1) {
    throw new HttpError(400, INVALID_RESET);
  }
}
