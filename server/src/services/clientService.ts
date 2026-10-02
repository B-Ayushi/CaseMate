import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import { istToday } from '../lib/time.js';
import type { ClientBody } from '../validators/clientValidators.js';

const NOT_FOUND = 'Client not found.';

export async function listClients(prisma: PrismaClient, lawyerId: string, search?: string) {
  const now = new Date();
  const clients = await prisma.client.findMany({
    where: {
      lawyerId,
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search.replace(/[\s-]/g, '') } },
              { email: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      preferredContact: true,
      cases: {
        where: { status: 'ACTIVE' },
        select: {
          hearings: {
            where: { status: 'SCHEDULED', scheduledAt: { gte: now } },
            orderBy: { scheduledAt: 'asc' },
            take: 1,
            select: { scheduledAt: true },
          },
        },
      },
    },
  });

  return clients.map(({ cases, ...client }) => {
    const upcoming = cases
      .map((c) => c.hearings[0]?.scheduledAt)
      .filter((d): d is Date => d !== undefined)
      .sort((a, b) => a.getTime() - b.getTime());
    return { ...client, activeCaseCount: cases.length, nextHearingAt: upcoming[0] ?? null };
  });
}

export async function getClientProfile(prisma: PrismaClient, lawyerId: string, id: string) {
  const now = new Date();
  const client = await prisma.client.findFirst({
    where: { id, lawyerId },
    include: {
      notes: { orderBy: { notedAt: 'desc' } },
      cases: {
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          title: true,
          caseNumber: true,
          courtName: true,
          status: true,
          hearings: {
            where: { status: 'SCHEDULED', scheduledAt: { gte: now } },
            orderBy: { scheduledAt: 'asc' },
            take: 1,
            select: { id: true, scheduledAt: true },
          },
        },
      },
      invoices: { select: { totalPaise: true, status: true, dueDate: true } },
    },
  });
  if (!client) {
    throw new HttpError(404, NOT_FOUND);
  }

  const unbilled = await prisma.timeEntry.aggregate({
    where: { lawyerId, invoiceId: null, case: { clientId: id } },
    _sum: { amountPaise: true },
  });

  const today = istToday(now);
  const billing = { billedPaise: 0, paidPaise: 0, duePaise: 0, overduePaise: 0, unbilledPaise: 0 };
  for (const invoice of client.invoices) {
    if (invoice.status === 'DRAFT') continue;
    billing.billedPaise += invoice.totalPaise;
    if (invoice.status === 'PAID') {
      billing.paidPaise += invoice.totalPaise;
    } else {
      billing.duePaise += invoice.totalPaise;
      if (invoice.dueDate < today) billing.overduePaise += invoice.totalPaise;
    }
  }
  billing.unbilledPaise = unbilled._sum.amountPaise ?? 0;

  const { invoices: _invoices, cases, ...rest } = client;
  return {
    ...rest,
    cases: cases.map(({ hearings, ...c }) => ({
      ...c,
      nextHearingAt: hearings[0]?.scheduledAt ?? null,
    })),
    billing,
  };
}

export async function createClient(prisma: PrismaClient, lawyerId: string, body: ClientBody) {
  return prisma.client.create({ data: { ...body, lawyerId } });
}

export async function updateClient(
  prisma: PrismaClient,
  lawyerId: string,
  id: string,
  body: ClientBody,
) {
  const { count } = await prisma.client.updateMany({ where: { id, lawyerId }, data: body });
  if (count === 0) {
    throw new HttpError(404, NOT_FOUND);
  }
  return prisma.client.findFirstOrThrow({ where: { id, lawyerId } });
}

export async function deleteClient(prisma: PrismaClient, lawyerId: string, id: string) {
  const client = await prisma.client.findFirst({
    where: { id, lawyerId },
    select: { _count: { select: { cases: true, invoices: true } } },
  });
  if (!client) {
    throw new HttpError(404, NOT_FOUND);
  }
  const { cases, invoices } = client._count;
  if (cases > 0 || invoices > 0) {
    const parts = [
      cases > 0 ? `${cases} case${cases === 1 ? '' : 's'}` : null,
      invoices > 0 ? `${invoices} invoice${invoices === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    throw new HttpError(
      409,
      `This client still has ${parts.join(' and ')}, so they cannot be deleted. Their records are kept for your billing history.`,
    );
  }
  await prisma.client.delete({ where: { id } });
}

export async function addClientNote(
  prisma: PrismaClient,
  lawyerId: string,
  clientId: string,
  note: { text: string; notedAt: Date },
) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, lawyerId },
    select: { id: true },
  });
  if (!client) {
    throw new HttpError(404, NOT_FOUND);
  }
  return prisma.clientNote.create({ data: { ...note, clientId, lawyerId } });
}

export async function deleteClientNote(
  prisma: PrismaClient,
  lawyerId: string,
  clientId: string,
  noteId: string,
) {
  const { count } = await prisma.clientNote.deleteMany({
    where: { id: noteId, clientId, lawyerId },
  });
  if (count === 0) {
    throw new HttpError(404, 'Note not found.');
  }
}
