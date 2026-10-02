import nodemailer from 'nodemailer';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/lib/config.js';
import { createMailer, type MailMessage } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';

export const TEST_CLIENT_URL = 'http://localhost:5173';

export const testConfig: AppConfig = {
  nodeEnv: 'test',
  clientUrl: TEST_CLIENT_URL,
  jwtSecret: 'test-only-jwt-secret-that-is-long-enough-0123456789',
};

// Builds the real app. Email goes through the real mailer code and Nodemailer, using its
// built-in JSON transport instead of SMTP so tests never deliver mail; every message the
// app sends is kept in `sentEmails` for the test to read.
export function buildTestApp(overrides: Partial<AppConfig> = {}) {
  const sentEmails: MailMessage[] = [];
  const mailer = createMailer(
    nodemailer.createTransport({ jsonTransport: true }),
    'CaseMate <test@casemate.invalid>',
  );
  const app = createApp({
    prisma,
    config: { ...testConfig, ...overrides },
    mailer: {
      async send(message) {
        await mailer.send(message);
        sentEmails.push(message);
      },
    },
  });
  return { app, sentEmails };
}

// Empties every table in the test database, children first.
export async function resetDatabase() {
  await prisma.timeEntry.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.hearing.deleteMany();
  await prisma.case.deleteMany();
  await prisma.clientNote.deleteMany();
  await prisma.client.deleteMany();
  await prisma.lawyer.deleteMany();
}
