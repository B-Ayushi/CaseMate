import type { Express } from 'express';
import nodemailer from 'nodemailer';
import request from 'supertest';
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

let lawyerCounter = 0;

// Signs up a lawyer through the real API and returns the session cookie to send back.
export async function signUpLawyer(app: Express, overrides: Record<string, unknown> = {}) {
  lawyerCounter += 1;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({
      name: `Test Advocate ${lawyerCounter}`,
      email: `advocate${lawyerCounter}-${Date.now()}@example.com`,
      phone: '9876543210',
      barCouncilNumber: `MAH/${lawyerCounter}/2015`,
      password: 'testpass123',
      ...overrides,
    });
  if (res.status !== 201) {
    throw new Error(`Signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((c) => c.startsWith('casemate_session='))!.split(';')[0]!;
  return { cookie, lawyer: res.body.lawyer as { id: string; email: string } };
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
