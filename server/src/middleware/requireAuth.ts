import type { PrismaClient } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import type { AppConfig } from '../lib/config.js';
import { HttpError } from '../lib/httpError.js';
import {
  endSession,
  SESSION_COOKIE,
  sessionMatchesPassword,
  verifySession,
} from '../lib/session.js';

const NOT_LOGGED_IN = 'Please log in to continue.';

// Reads the session cookie, verifies the JWT, checks the account still exists and the
// session was issued for its current password, and sets req.lawyerId. Every route that
// touches a lawyer's data must sit behind this. A session that has ended (password
// changed elsewhere, account deleted) has its cookie cleared.
export function requireAuth(
  prisma: PrismaClient,
  config: Pick<AppConfig, 'jwtSecret' | 'nodeEnv'>,
): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const claims = typeof token === 'string' ? verifySession(token, config.jwtSecret) : null;
    if (!claims) {
      throw new HttpError(401, NOT_LOGGED_IN);
    }

    const lawyer = await prisma.lawyer.findUnique({
      where: { id: claims.lawyerId },
      select: { passwordHash: true },
    });
    if (!lawyer || !sessionMatchesPassword(claims, lawyer.passwordHash, config.jwtSecret)) {
      endSession(res, config);
      throw new HttpError(401, NOT_LOGGED_IN);
    }

    req.lawyerId = claims.lawyerId;
    next();
  };
}

// For handlers behind requireAuth: the logged-in lawyer's id.
export function currentLawyerId(req: Request): string {
  if (!req.lawyerId) {
    throw new HttpError(401, NOT_LOGGED_IN);
  }
  return req.lawyerId;
}
