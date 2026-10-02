import { createApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';
import { env } from './lib/env.js';
import { createMailerFromEnv } from './lib/mailer.js';
import { prisma } from './lib/prisma.js';
import { createSmsProviderFromEnv } from './lib/sms.js';

const email = createMailerFromEnv(env, { verify: true });
const sms = createSmsProviderFromEnv(env);

const app = createApp({
  prisma,
  mailer: email.mailer,
  sms,
  config: { nodeEnv: env.NODE_ENV, clientUrl: env.CLIENT_URL, jwtSecret: env.JWT_SECRET },
});

const server = app.listen(env.PORT, () => {
  console.log(`CaseMate API listening on http://localhost:${env.PORT}`);
});

let scheduler: { stop: () => void } | null = null;
if (env.ENABLE_SCHEDULER) {
  scheduler = startScheduler({ prisma, mailer: email.mailer, sms, clientUrl: env.CLIENT_URL });
} else {
  console.log(
    'Reminder scheduler is off (set ENABLE_SCHEDULER=true in server/.env to send reminders)',
  );
}

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  scheduler?.stop();
  server.close();
  email.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
