// `npm run reminders:tick`: one pass of the reminder engine, through the same code as the
// 5-minute cron job, using the real database, SMTP and SMS settings from server/.env.
// It runs whether or not ENABLE_SCHEDULER is set.
import { env } from '../lib/env.js';
import { createMailerFromEnv } from '../lib/mailer.js';
import { prisma } from '../lib/prisma.js';
import { createSmsProviderFromEnv } from '../lib/sms.js';
import { reminderTick } from './scheduler.js';

const email = createMailerFromEnv(env);
const sms = createSmsProviderFromEnv(env);

try {
  await reminderTick({ prisma, mailer: email.mailer, sms, clientUrl: env.CLIENT_URL });
} catch (error) {
  console.error('[reminders] run failed:', error);
  process.exitCode = 1;
} finally {
  email.close();
  await prisma.$disconnect();
}
