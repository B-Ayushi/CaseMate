import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { settingsController } from '../controllers/settingsController.js';
import type { AppDeps } from '../lib/config.js';

// Limits for the logged-in lawyer, counted per account (each app instance has its own
// counters).
function perLawyer(options: {
  windowMs: number;
  limit: number;
  error: string;
  failedOnly?: boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    skipSuccessfulRequests: options.failedOnly ?? false,
    keyGenerator: (req) => req.lawyerId ?? 'anonymous',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: options.error },
  });
}

// Mounted behind requireAuth at /api/settings.
export function settingsRoutes(deps: AppDeps): Router {
  const router = Router();
  const controller = settingsController(deps);
  const HOUR = 60 * 60 * 1000;

  // Each one sends a real email and SMS.
  const testReminderLimit = perLawyer({
    windowMs: HOUR,
    limit: 5,
    error: 'You can send 5 test reminders an hour. Please try again later.',
  });
  // Both check the password, so wrong guesses are limited like logins.
  const passwordCheckLimit = perLawyer({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    failedOnly: true,
    error: 'Too many attempts with a wrong password. Please wait 15 minutes and try again.',
  });

  router.get('/profile', controller.getProfile);
  router.patch('/profile', controller.updateProfile);
  router.post('/password', passwordCheckLimit, controller.changePassword);
  router.get('/reminders', controller.getReminders);
  router.patch('/reminders', controller.updateReminders);
  router.get('/billing', controller.getBilling);
  router.patch('/billing', controller.updateBilling);
  router.post('/test-reminder', testReminderLimit, controller.testReminder);
  router.get('/export', controller.exportData);
  router.delete('/account', passwordCheckLimit, controller.deleteAccount);

  return router;
}
