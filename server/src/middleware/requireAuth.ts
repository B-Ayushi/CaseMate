import type { Request, RequestHandler } from 'express';
import { HttpError } from '../lib/httpError.js';
import { SESSION_COOKIE, verifySession } from '../lib/session.js';

const NOT_LOGGED_IN = 'Please log in to continue.';

// Reads the session cookie, verifies the JWT and sets req.lawyerId. Every route that
// touches a lawyer's data must sit behind this.
export function requireAuth(jwtSecret: string): RequestHandler {
  return (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const lawyerId = typeof token === 'string' ? verifySession(token, jwtSecret) : null;
    if (!lawyerId) {
      throw new HttpError(401, NOT_LOGGED_IN);
    }
    req.lawyerId = lawyerId;
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
