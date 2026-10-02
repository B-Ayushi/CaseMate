import type { CookieOptions } from 'express';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE = 'casemate_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signSession(lawyerId: string, secret: string): string {
  return jwt.sign({}, secret, {
    algorithm: 'HS256',
    subject: lawyerId,
    expiresIn: SESSION_TTL_SECONDS,
  });
}

// Returns the lawyer id from a valid token, or null for a missing, tampered or expired one.
export function verifySession(token: string, secret: string): string | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  };
}
