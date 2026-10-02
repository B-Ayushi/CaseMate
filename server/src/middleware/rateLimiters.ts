import { rateLimit } from 'express-rate-limit';

// Limits are per IP address. Each app instance gets its own counters.
export function createAuthRateLimiters() {
  return {
    // Only failed attempts count, so a lawyer who logs in correctly is never locked out.
    login: rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
    }),
    forgotPassword: rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 5,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many reset requests. Please wait an hour and try again.' },
    }),
    // Each signup runs a deliberately slow bcrypt hash, so it is limited too.
    signup: rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many sign-ups from this network. Please try again later.' },
    }),
  };
}
