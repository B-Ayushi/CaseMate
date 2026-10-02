import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { buildTestApp, resetDatabase, signUpLawyer } from './helpers.js';

const newClient = {
  name: 'Ramesh Gupta',
  phone: '98220 11223',
  email: 'ramesh@example.com',
  address: '12 FC Road, Pune',
  preferredContact: 'WHATSAPP',
  languages: 'Marathi, Hindi',
  hourlyRatePaise: 250000,
};

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('clients API', () => {
  it('requires login', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/api/clients')).status).toBe(401);
    expect((await request(app).post('/api/clients').send(newClient)).status).toBe(401);
  });

  it('creates, lists, searches, updates and deletes a client', async () => {
    const { app } = buildTestApp();
    const { cookie, lawyer } = await signUpLawyer(app);

    const created = await request(app).post('/api/clients').set('Cookie', cookie).send(newClient);
    expect(created.status).toBe(201);
    expect(created.body.client).toMatchObject({
      name: 'Ramesh Gupta',
      phone: '+919822011223',
      lawyerId: lawyer.id,
      hourlyRatePaise: 250000,
    });
    const id = created.body.client.id as string;

    const list = await request(app).get('/api/clients').set('Cookie', cookie);
    expect(list.body.clients).toHaveLength(1);
    expect(list.body.clients[0]).toMatchObject({ id, activeCaseCount: 0, nextHearingAt: null });

    const found = await request(app).get('/api/clients?search=gup').set('Cookie', cookie);
    const missing = await request(app).get('/api/clients?search=zzz').set('Cookie', cookie);
    expect(found.body.clients).toHaveLength(1);
    expect(missing.body.clients).toHaveLength(0);

    const updated = await request(app)
      .put(`/api/clients/${id}`)
      .set('Cookie', cookie)
      .send({ ...newClient, name: 'Ramesh K. Gupta', email: '', preferredContact: 'PHONE' });
    expect(updated.status).toBe(200);
    expect(updated.body.client).toMatchObject({ name: 'Ramesh K. Gupta', email: null });

    // Saving without any change is fine too.
    const unchanged = await request(app)
      .put(`/api/clients/${id}`)
      .set('Cookie', cookie)
      .send({ ...newClient, name: 'Ramesh K. Gupta', email: '', preferredContact: 'PHONE' });
    expect(unchanged.status).toBe(200);

    const profile = await request(app).get(`/api/clients/${id}`).set('Cookie', cookie);
    expect(profile.status).toBe(200);
    expect(profile.body.client.billing).toEqual({
      billedPaise: 0,
      paidPaise: 0,
      duePaise: 0,
      overduePaise: 0,
      unbilledPaise: 0,
    });

    expect((await request(app).delete(`/api/clients/${id}`).set('Cookie', cookie)).status).toBe(
      204,
    );
    expect(await prisma.client.count()).toBe(0);
  });

  it('validates the body and requires an email when email is the preferred contact', async () => {
    const { app } = buildTestApp();
    const { cookie } = await signUpLawyer(app);

    const res = await request(app)
      .post('/api/clients')
      .set('Cookie', cookie)
      .send({
        ...newClient,
        phone: '123',
        email: '',
        preferredContact: 'EMAIL',
        hourlyRatePaise: -1,
      });

    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['email', 'hourlyRatePaise', 'phone']);
  });

  it('adds and deletes notes, newest first', async () => {
    const { app } = buildTestApp();
    const { cookie } = await signUpLawyer(app);
    const id = (await request(app).post('/api/clients').set('Cookie', cookie).send(newClient)).body
      .client.id;

    await request(app)
      .post(`/api/clients/${id}/notes`)
      .set('Cookie', cookie)
      .send({ text: 'First call', notedAt: '2026-10-01T10:00:00+05:30' })
      .expect(201);
    const second = await request(app)
      .post(`/api/clients/${id}/notes`)
      .set('Cookie', cookie)
      .send({ text: 'Sent the sale agreement copy' })
      .expect(201);

    const profile = await request(app).get(`/api/clients/${id}`).set('Cookie', cookie);
    expect(profile.body.client.notes.map((n: { text: string }) => n.text)).toEqual([
      'Sent the sale agreement copy',
      'First call',
    ]);

    await request(app)
      .delete(`/api/clients/${id}/notes/${second.body.note.id}`)
      .set('Cookie', cookie)
      .expect(204);
    expect(await prisma.clientNote.count()).toBe(1);
  });

  it("never lets one lawyer see or change another lawyer's client", async () => {
    const { app } = buildTestApp();
    const owner = await signUpLawyer(app);
    const other = await signUpLawyer(app);
    const id = (await request(app).post('/api/clients').set('Cookie', owner.cookie).send(newClient))
      .body.client.id;
    const as = (r: request.Test) => r.set('Cookie', other.cookie);

    expect((await as(request(app).get('/api/clients'))).body.clients).toEqual([]);
    expect((await as(request(app).get(`/api/clients/${id}`))).status).toBe(404);
    expect((await as(request(app).put(`/api/clients/${id}`).send(newClient))).status).toBe(404);
    expect((await as(request(app).delete(`/api/clients/${id}`))).status).toBe(404);
    expect(
      (await as(request(app).post(`/api/clients/${id}/notes`).send({ text: 'x' }))).status,
    ).toBe(404);

    const stillThere = await prisma.client.findUniqueOrThrow({ where: { id } });
    expect(stillThere.name).toBe('Ramesh Gupta');
    expect(await prisma.clientNote.count()).toBe(0);
  });

  it('refuses to delete a client who has cases', async () => {
    const { app } = buildTestApp();
    const { cookie, lawyer } = await signUpLawyer(app);
    const id = (await request(app).post('/api/clients').set('Cookie', cookie).send(newClient)).body
      .client.id;
    await prisma.case.create({
      data: {
        lawyerId: lawyer.id,
        clientId: id,
        title: 'Gupta vs. Mehta Builders',
        caseNumber: 'RCS/1/2026',
        courtName: 'Civil Court, Pune',
      },
    });

    const res = await request(app).delete(`/api/clients/${id}`).set('Cookie', cookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/still has 1 case/);
  });

  it('returns 404 for a malformed id', async () => {
    const { app } = buildTestApp();
    const { cookie } = await signUpLawyer(app);
    expect((await request(app).get('/api/clients/not-an-id').set('Cookie', cookie)).status).toBe(
      404,
    );
  });
});
