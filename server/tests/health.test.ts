import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';
import { buildTestApp, testConfig } from './helpers.js';

describe('GET /api/health', () => {
  // A real client pointed at a port where nothing listens, to exercise the failure path.
  const unreachable = new PrismaClient({
    datasourceUrl: 'mysql://casemate:casemate@127.0.0.1:1/casemate?connect_timeout=2',
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), unreachable.$disconnect()]);
  });

  it('reports ok when the test database answers a real query', async () => {
    const res = await request(buildTestApp().app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('returns 503 with a clear message when the database cannot be reached', async () => {
    const app = createApp({
      prisma: unreachable,
      config: testConfig,
      mailer: createMailer(
        nodemailer.createTransport({ jsonTransport: true }),
        'test@casemate.invalid',
      ),
    });
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.database).toBe('error');
    expect(res.body.message).toMatch(/Cannot connect to the database/);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(buildTestApp().app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
