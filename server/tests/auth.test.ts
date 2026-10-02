import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { errorHandler } from '../src/middleware/errorHandlers.js';
import { buildTestApp, resetDatabase, TEST_CLIENT_URL } from './helpers.js';

const SECRET_FIELDS = ['passwordHash', 'passwordResetTokenHash', 'passwordResetExpiresAt'];

const validSignup = {
  name: 'Test Advocate',
  email: 'Advocate.Test@Example.com',
  phone: '+91 98765 43210',
  barCouncilNumber: 'MAH/1234/2015',
  password: 'firstpass123',
};

function sessionCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('casemate_session='));
  if (!cookie) throw new Error('No session cookie was set');
  return cookie;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

async function signUp(app: express.Express, overrides: Partial<typeof validSignup> = {}) {
  return request(app)
    .post('/api/auth/signup')
    .send({ ...validSignup, ...overrides });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('POST /api/auth/signup', () => {
  it('creates the lawyer with a bcrypt hash and logs them in', async () => {
    const { app } = buildTestApp();
    const res = await signUp(app);

    expect(res.status).toBe(201);
    expect(res.body.lawyer).toMatchObject({
      name: 'Test Advocate',
      email: 'advocate.test@example.com',
      phone: '+919876543210',
      barCouncilNumber: 'MAH/1234/2015',
      dailySummaryTime: '07:00',
    });
    for (const field of SECRET_FIELDS) expect(res.body.lawyer).not.toHaveProperty(field);

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=604800/);
    expect(cookie).not.toMatch(/Secure/i);

    const stored = await prisma.lawyer.findUniqueOrThrow({
      where: { email: 'advocate.test@example.com' },
    });
    expect(stored.passwordHash).toMatch(/^\$2b\$12\$/);
    expect(await bcrypt.compare('firstpass123', stored.passwordHash)).toBe(true);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookiePair(cookie));
    expect(me.status).toBe(200);
    expect(me.body.lawyer.id).toBe(stored.id);
  });

  it('rejects a duplicate email, whatever its letter case', async () => {
    const { app } = buildTestApp();
    expect((await signUp(app)).status).toBe(201);

    const res = await signUp(app, { email: 'ADVOCATE.TEST@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.lawyer.count()).toBe(1);
  });

  it('rejects invalid fields with a message for each one', async () => {
    const { app } = buildTestApp();
    const res = await signUp(app, {
      email: 'not-an-email',
      phone: '12345',
      password: 'onlyletters',
      name: '  ',
    });

    expect(res.status).toBe(400);
    expect(res.body.fields).toEqual({
      name: 'Enter your name',
      email: 'Enter a valid email address',
      phone: 'Enter a valid Indian mobile number, for example 98765 43210',
      password: 'Password must include at least one letter and one number',
    });
    expect(await prisma.lawyer.count()).toBe(0);
  });

  it('accepts the common ways of writing an Indian mobile number', async () => {
    const { app } = buildTestApp();
    const formats = ['9876543210', '09876543210', '919876543210', '+91-98765-43210'];
    for (const [i, phone] of formats.entries()) {
      const res = await signUp(app, { phone, email: `phone${i}@example.com` });
      expect(res.status, phone).toBe(201);
      expect(res.body.lawyer.phone).toBe('+919876543210');
    }
  });

  it('sets a Secure cookie in production', async () => {
    const { app } = buildTestApp({ nodeEnv: 'production' });
    const res = await signUp(app);

    expect(res.status).toBe(201);
    expect(sessionCookie(res)).toMatch(/; Secure/i);
  });
});

describe('POST /api/auth/login and /logout', () => {
  it('logs in with the right password', async () => {
    const { app } = buildTestApp();
    await signUp(app);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'advocate.test@example.com', password: 'firstpass123' });

    expect(res.status).toBe(200);
    expect(res.body.lawyer.email).toBe('advocate.test@example.com');
    for (const field of SECRET_FIELDS) expect(res.body.lawyer).not.toHaveProperty(field);
    expect(sessionCookie(res)).toMatch(/HttpOnly/i);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { app } = buildTestApp();
    await signUp(app);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'advocate.test@example.com', password: 'wrongpass123' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrongpass123' });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: 'Email or password is incorrect.' });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('blocks an IP after 10 failed logins in 15 minutes', async () => {
    const { app } = buildTestApp();
    const attempt = () =>
      request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrongpass123' });

    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many login attempts/);
  });

  it('logout clears the session cookie', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/^casemate_session=;/);
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a cookie', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Please log in to continue.' });
  });

  it('returns 401 for a tampered or foreign token', async () => {
    const { app } = buildTestApp();
    const signup = await signUp(app);
    const [name, token] = cookiePair(sessionCookie(signup)).split('=');
    const tampered = `${name}=${token!.slice(0, -2)}xx`;

    const otherApp = buildTestApp({
      jwtSecret: 'a-different-secret-that-is-also-long-enough-123',
    }).app;

    expect((await request(app).get('/api/auth/me').set('Cookie', tampered)).status).toBe(401);
    expect(
      (
        await request(otherApp)
          .get('/api/auth/me')
          .set('Cookie', cookiePair(sessionCookie(signup)))
      ).status,
    ).toBe(401);
  });

  it('returns the lawyer without any secret fields', async () => {
    const { app } = buildTestApp();
    const cookie = cookiePair(sessionCookie(await signUp(app)));

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.lawyer.email).toBe('advocate.test@example.com');
    for (const field of SECRET_FIELDS) expect(res.body.lawyer).not.toHaveProperty(field);
  });

  it('returns 401 once the account no longer exists', async () => {
    const { app } = buildTestApp();
    const cookie = cookiePair(sessionCookie(await signUp(app)));
    await prisma.lawyer.deleteMany();

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});

describe('password reset', () => {
  const FORGOT_RESPONSE = {
    message: 'If an account exists for that email, we have sent a link to reset the password.',
  };

  function tokenFromEmail(text: string): string {
    const link = text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error('No link in the reset email');
    expect(link.startsWith(`${TEST_CLIENT_URL}/reset-password?token=`)).toBe(true);
    return new URL(link).searchParams.get('token')!;
  }

  it('answers the same way for known and unknown emails', async () => {
    const { app, sentEmails } = buildTestApp();
    await signUp(app);

    const known = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'advocate.test@example.com' });
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(FORGOT_RESPONSE);
    expect(unknown.body).toEqual(FORGOT_RESPONSE);

    await vi.waitFor(() => expect(sentEmails).toHaveLength(1));
    expect(sentEmails[0]!.to).toBe('advocate.test@example.com');
  });

  it('runs the full flow: email, stored hash, reset, single use', async () => {
    const { app, sentEmails } = buildTestApp();
    await signUp(app);
    const requestedAt = Date.now();

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'Advocate.Test@example.com' })
      .expect(200);
    await vi.waitFor(() => expect(sentEmails).toHaveLength(1));

    const email = sentEmails[0]!;
    expect(email.subject).toBe('Reset your CaseMate password');
    const token = tokenFromEmail(email.text);

    // Only the SHA-256 hash of the token is stored, with a 30-minute expiry.
    const pending = await prisma.lawyer.findUniqueOrThrow({
      where: { email: 'advocate.test@example.com' },
    });
    expect(pending.passwordResetTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(pending.passwordResetTokenHash).not.toContain(token);
    const expiresInMs = pending.passwordResetExpiresAt!.getTime() - requestedAt;
    expect(expiresInMs).toBeGreaterThan(29 * 60 * 1000);
    expect(expiresInMs).toBeLessThanOrEqual(30 * 60 * 1000 + 5000);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'secondpass456' });
    expect(reset.status).toBe(200);

    const after = await prisma.lawyer.findUniqueOrThrow({ where: { id: pending.id } });
    expect(after.passwordResetTokenHash).toBeNull();
    expect(after.passwordResetExpiresAt).toBeNull();
    expect(await bcrypt.compare('secondpass456', after.passwordHash)).toBe(true);

    const login = (password: string) =>
      request(app).post('/api/auth/login').send({ email: 'advocate.test@example.com', password });
    expect((await login('firstpass123')).status).toBe(401);
    expect((await login('secondpass456')).status).toBe(200);

    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'thirdpass789' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toMatch(/invalid or has expired/);
  });

  it('rejects an expired token and leaves the password unchanged', async () => {
    const { app, sentEmails } = buildTestApp();
    await signUp(app);
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'advocate.test@example.com' })
      .expect(200);
    await vi.waitFor(() => expect(sentEmails).toHaveLength(1));
    const token = tokenFromEmail(sentEmails[0]!.text);

    await prisma.lawyer.update({
      where: { email: 'advocate.test@example.com' },
      data: { passwordResetExpiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'secondpass456' });

    expect(res.status).toBe(400);
    const lawyer = await prisma.lawyer.findUniqueOrThrow({
      where: { email: 'advocate.test@example.com' },
    });
    expect(await bcrypt.compare('firstpass123', lawyer.passwordHash)).toBe(true);
  });

  it('rejects a made-up token and a weak new password', async () => {
    const { app } = buildTestApp();

    const unknown = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'secondpass456' });
    const weak = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'short1' });

    expect(unknown.status).toBe(400);
    expect(weak.status).toBe(400);
    expect(weak.body.fields.password).toBe('Password must be at least 8 characters');
  });

  it('limits forgot-password to 5 requests an hour per IP', async () => {
    const { app } = buildTestApp();
    const ask = () =>
      request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });

    for (let i = 0; i < 5; i++) expect((await ask()).status).toBe(200);
    const blocked = await ask();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many reset requests/);
  });
});

describe('error handler', () => {
  it('turns malformed JSON into a clean 400', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'The request body is not valid JSON.' });
  });

  it('never sends a stack trace in production', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.get('/boom', () => {
      throw new Error('database password is hunter2');
    });
    app.use(errorHandler({ nodeEnv: 'production' }));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Something went wrong on the server. Please try again.' });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
