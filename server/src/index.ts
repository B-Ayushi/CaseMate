import { createApp } from './app.js';
import { env } from './lib/env.js';
import {
  createMailer,
  createSmtpTransport,
  createUnconfiguredMailer,
  type Mailer,
} from './lib/mailer.js';
import { prisma } from './lib/prisma.js';

function buildMailer(): { mailer: Mailer; close: () => void } {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) {
    console.warn(
      'Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM in server/.env). ' +
        'Password reset emails, reminders and invoices will fail to send until it is.',
    );
    return { mailer: createUnconfiguredMailer(), close: () => {} };
  }

  const smtp = createSmtpTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: SMTP_USER,
    pass: SMTP_PASS,
  });
  // Check the SMTP login at startup so a wrong password shows up now, not when a lawyer
  // first needs an email.
  smtp.verify().then(
    () => console.log(`SMTP ready (${SMTP_HOST}:${SMTP_PORT})`),
    (error: unknown) =>
      console.error(
        `SMTP check failed for ${SMTP_HOST}:${SMTP_PORT}. Emails will not send until this is fixed:`,
        error instanceof Error ? error.message : error,
      ),
  );
  return { mailer: createMailer(smtp, EMAIL_FROM), close: () => smtp.close() };
}

const email = buildMailer();

const app = createApp({
  prisma,
  mailer: email.mailer,
  config: { nodeEnv: env.NODE_ENV, clientUrl: env.CLIENT_URL, jwtSecret: env.JWT_SECRET },
});

const server = app.listen(env.PORT, () => {
  console.log(`CaseMate API listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close();
  email.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
