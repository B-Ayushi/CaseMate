import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AppConfig } from './config.js';

export const SESSION_COOKIE = 'casemate_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// A short fingerprint of the lawyer's current password hash, carried in every session
// token. Changing or resetting the password changes the hash, and so the fingerprint:
// every session issued before the change stops being accepted, while the session that
// made the change is re-issued with the new fingerprint. (A keyed hash, so the token
// reveals nothing about the password hash.)
export function passwordFingerprint(passwordHash: string, secret: string): string {
  return createHmac('sha256', secret).update(passwordHash).digest('base64url').slice(0, 22);
}

export function signSession(lawyerId: string, passwordHash: string, secret: string): string {
  return jwt.sign({ pwf: passwordFingerprint(passwordHash, secret) }, secret, {
    algorithm: 'HS256',
    subject: lawyerId,
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export interface SessionClaims {
  lawyerId: string;
  fingerprint: string;
}

// The claims of a valid token, or null for a missing, tampered or expired one.
export function verifySession(token: string, secret: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.pwf !== 'string'
    ) {
      return null;
    }
    return { lawyerId: payload.sub, fingerprint: payload.pwf };
  } catch {
    return null;
  }
}

// Whether a session's fingerprint matches the lawyer's current password hash.
export function sessionMatchesPassword(
  claims: SessionClaims,
  passwordHash: string,
  secret: string,
): boolean {
  const expected = Buffer.from(passwordFingerprint(passwordHash, secret));
  const actual = Buffer.from(claims.fingerprint);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sessionCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  };
}

// Sets a fresh session cookie for the lawyer, tied to their current password.
export async function startSession(
  res: Response,
  prisma: PrismaClient,
  config: Pick<AppConfig, 'jwtSecret' | 'nodeEnv'>,
  lawyerId: string,
): Promise<void> {
  const { passwordHash } = await prisma.lawyer.findUniqueOrThrow({
    where: { id: lawyerId },
    select: { passwordHash: true },
  });
  res.cookie(SESSION_COOKIE, signSession(lawyerId, passwordHash, config.jwtSecret), {
    ...sessionCookieOptions(config.nodeEnv === 'production'),
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function endSession(res: Response, config: Pick<AppConfig, 'nodeEnv'>): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config.nodeEnv === 'production'));
}
