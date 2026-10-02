import type { Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import type { Mailer } from '../lib/mailer.js';
import { formatPaise } from '../lib/money.js';
import { addDaysToIsoDay, dateOnly, istDateString } from '../lib/time.js';
import type { CreateInvoiceInput, UpdateInvoiceInput } from '../validators/billingValidators.js';
import { invoiceEmail } from './emails/invoiceEmail.js';
import { buildInvoicePdf } from './invoicePdf.js';
import { invoiceDisplayStatus, type InvoiceDisplayStatus } from './invoiceStatus.js';
import { describeFailure } from './reminderFailures.js';

const NOT_FOUND = 'Invoice not found.';
export const DEFAULT_DUE_DAYS = 15;
// Totals live in a 32-bit column.
const MAX_TOTAL_PAISE = 2_000_000_000;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

const invoiceSelect = {
  id: true,
  number: true,
  issueDate: true,
  dueDate: true,
  totalPaise: true,
  status: true,
  sentAt: true,
  paidAt: true,
  notes: true,
  createdAt: true,
  client: { select: { id: true, name: true, email: true } },
  _count: { select: { timeEntries: true } },
} satisfies Prisma.InvoiceSelect;

type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

function present(invoice: InvoiceRow, now = new Date()) {
  const { _count, issueDate, dueDate, ...rest } = invoice;
  return {
    ...rest,
    issueDate: isoDay(issueDate),
    dueDate: isoDay(dueDate),
    entryCount: _count.timeEntries,
    displayStatus: invoiceDisplayStatus(invoice, now),
  };
}

async function findOwned(db: Prisma.TransactionClient, lawyerId: string, id: string) {
  const invoice = await db.invoice.findFirst({ where: { id, lawyerId }, select: invoiceSelect });
  if (!invoice) throw new HttpError(404, NOT_FOUND);
  return invoice;
}

export async function listInvoices(
  prisma: PrismaClient,
  lawyerId: string,
  filter: { status?: InvoiceDisplayStatus; clientId?: string },
) {
  const now = new Date();
  const where: Prisma.InvoiceWhereInput = { lawyerId };
  if (filter.clientId) where.clientId = filter.clientId;
  if (filter.status === 'OVERDUE') {
    where.status = 'SENT';
    where.dueDate = { lt: dateOnly(istDateString(now)) };
  } else if (filter.status) {
    where.status = filter.status;
  }
  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
    select: invoiceSelect,
  });
  return invoices.map((i) => present(i, now));
}

export async function getInvoice(prisma: PrismaClient, lawyerId: string, id: string) {
  const invoice = await findOwned(prisma, lawyerId, id);
  const entries = await prisma.timeEntry.findMany({
    where: { invoiceId: id, lawyerId },
    orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      workDate: true,
      minutes: true,
      description: true,
      ratePaise: true,
      amountPaise: true,
      case: { select: { id: true, title: true, caseNumber: true } },
    },
  });
  return {
    ...present(invoice),
    entries: entries.map((e) => ({ ...e, workDate: isoDay(e.workDate) })),
  };
}

// The next number in the lawyer's sequence: INV-001, INV-002, ... Called with the
// lawyer's row locked, and the read itself is a locking read, so two invoices created at
// the same moment are numbered one after the other: never the same number, never a
// skipped one. (Only deleting an older draft can leave a hole; deleting the latest draft
// frees its number for the next invoice.)
async function nextInvoiceNumber(tx: Prisma.TransactionClient, lawyerId: string) {
  const [row] = await tx.$queryRaw<{ highest: bigint | number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(number, 5) AS UNSIGNED)) AS highest
    FROM invoices WHERE lawyerId = ${lawyerId} FOR UPDATE`;
  const next = Number(row?.highest ?? 0) + 1;
  return `INV-${String(next).padStart(3, '0')}`;
}

// Creates an invoice for one client from some of their unbilled time entries, all in one
// transaction: the total is the sum of the entries' stored amounts (never typed in), and
// the entries are attached to it so they cannot be billed twice or changed.
export async function createInvoice(
  prisma: PrismaClient,
  lawyerId: string,
  input: CreateInvoiceInput,
  now = new Date(),
) {
  const ids = [...new Set(input.timeEntryIds)];
  const issueDate = input.issueDate ?? istDateString(now);
  const dueDate = input.dueDate ?? addDaysToIsoDay(issueDate, DEFAULT_DUE_DAYS);
  if (dueDate < issueDate) {
    throw new HttpError(400, 'The due date cannot be before the issue date.', {
      dueDate: 'The due date cannot be before the issue date',
    });
  }

  const invoiceId = await prisma.$transaction(
    async (tx) => {
      // One invoice at a time per lawyer: everything below runs with this row locked.
      await tx.$queryRaw`SELECT id FROM lawyers WHERE id = ${lawyerId} FOR UPDATE`;

      const client = await tx.client.findFirst({
        where: { id: input.clientId, lawyerId },
        select: { id: true },
      });
      if (!client) throw new HttpError(404, 'Client not found.');

      const entries = await tx.timeEntry.findMany({
        where: { id: { in: ids }, lawyerId, invoiceId: null, case: { clientId: input.clientId } },
        select: { id: true, amountPaise: true },
      });
      if (entries.length !== ids.length) {
        throw new HttpError(
          409,
          'Some of the chosen time entries are already on an invoice or belong to another client. Refresh and choose again.',
        );
      }
      const totalPaise = entries.reduce((sum, e) => sum + e.amountPaise, 0);
      if (totalPaise > MAX_TOTAL_PAISE) {
        throw new HttpError(
          400,
          'This invoice total is too large. Split the time into two invoices.',
        );
      }

      const invoice = await tx.invoice.create({
        data: {
          lawyerId,
          clientId: input.clientId,
          number: await nextInvoiceNumber(tx, lawyerId),
          issueDate: dateOnly(issueDate),
          dueDate: dateOnly(dueDate),
          totalPaise,
          notes: input.notes,
        },
        select: { id: true },
      });
      const { count } = await tx.timeEntry.updateMany({
        where: { id: { in: ids }, lawyerId, invoiceId: null },
        data: { invoiceId: invoice.id },
      });
      if (count !== ids.length) {
        throw new HttpError(409, 'Some of the chosen time entries were just billed. Try again.');
      }
      return invoice.id;
    },
    { timeout: 30_000 },
  );
  return getInvoice(prisma, lawyerId, invoiceId);
}

// The due date and notes can be corrected until the invoice is paid.
export async function updateInvoice(
  prisma: PrismaClient,
  lawyerId: string,
  id: string,
  input: UpdateInvoiceInput,
) {
  const invoice = await findOwned(prisma, lawyerId, id);
  if (invoice.status === 'PAID') {
    throw new HttpError(409, 'This invoice has been paid, so it can no longer be changed.');
  }
  if (input.dueDate < isoDay(invoice.issueDate)) {
    throw new HttpError(400, 'The due date cannot be before the issue date.', {
      dueDate: 'The due date cannot be before the issue date',
    });
  }
  await prisma.invoice.update({
    where: { id },
    data: { dueDate: dateOnly(input.dueDate), notes: input.notes },
  });
  return getInvoice(prisma, lawyerId, id);
}

// Only a draft can be deleted. Its time entries go back to the unbilled list.
export async function deleteDraft(prisma: PrismaClient, lawyerId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const invoice = await findOwned(tx, lawyerId, id);
    if (invoice.status !== 'DRAFT') {
      throw new HttpError(
        409,
        `Invoice ${invoice.number} has been ${invoice.status === 'PAID' ? 'paid' : 'sent'}, so it can't be deleted.`,
      );
    }
    await tx.timeEntry.updateMany({
      where: { invoiceId: id, lawyerId },
      data: { invoiceId: null },
    });
    const { count } = await tx.invoice.deleteMany({ where: { id, lawyerId, status: 'DRAFT' } });
    if (count !== 1)
      throw new HttpError(409, 'This invoice was just sent and can no longer be deleted.');
  });
}

export async function markSent(prisma: PrismaClient, lawyerId: string, id: string) {
  const invoice = await findOwned(prisma, lawyerId, id);
  if (invoice.status === 'PAID') throw new HttpError(409, 'This invoice has already been paid.');
  if (invoice.status === 'DRAFT') {
    await prisma.invoice.updateMany({
      where: { id, lawyerId, status: 'DRAFT' },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }
  return getInvoice(prisma, lawyerId, id);
}

export async function markPaid(prisma: PrismaClient, lawyerId: string, id: string) {
  const invoice = await findOwned(prisma, lawyerId, id);
  if (invoice.status !== 'PAID') {
    await prisma.invoice.updateMany({
      where: { id, lawyerId, status: { not: 'PAID' } },
      data: { status: 'PAID', paidAt: new Date() },
    });
  }
  return getInvoice(prisma, lawyerId, id);
}

// Everything the PDF shows, from the stored invoice (never recalculated).
export async function invoicePdf(prisma: PrismaClient, lawyerId: string, id: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, lawyerId },
    include: {
      lawyer: { select: { name: true, email: true, phone: true, barCouncilNumber: true } },
      client: { select: { name: true, address: true, phone: true, email: true } },
      timeEntries: {
        orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
        include: { case: { select: { title: true, caseNumber: true } } },
      },
    },
  });
  if (!invoice) throw new HttpError(404, NOT_FOUND);

  const pdf = await buildInvoicePdf({
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    notes: invoice.notes,
    totalPaise: invoice.totalPaise,
    lawyer: invoice.lawyer,
    client: invoice.client,
    entries: invoice.timeEntries.map((e) => ({
      workDate: e.workDate,
      caseTitle: e.case.title,
      caseNumber: e.case.caseNumber,
      description: e.description,
      minutes: e.minutes,
      amountPaise: e.amountPaise,
    })),
  });
  return { pdf, filename: `${invoice.number}.pdf`, invoice };
}

// Emails the PDF to the client. The invoice becomes SENT only once the email has gone
// out; if sending fails it stays as it was and the reason comes back in plain English.
export async function sendInvoice(
  deps: { prisma: PrismaClient; mailer: Mailer },
  lawyerId: string,
  id: string,
) {
  const { prisma, mailer } = deps;
  const { pdf, filename, invoice } = await invoicePdf(prisma, lawyerId, id);
  if (invoice.status === 'PAID') throw new HttpError(409, 'This invoice has already been paid.');
  if (!invoice.client.email) {
    throw new HttpError(
      409,
      `${invoice.client.name} has no email address. Add one to the client, or share the PDF another way and use "Mark as sent".`,
    );
  }

  try {
    await mailer.send({
      ...invoiceEmail({
        to: invoice.client.email,
        clientName: invoice.client.name,
        lawyerName: invoice.lawyer.name,
        number: invoice.number,
        total: formatPaise(invoice.totalPaise),
        dueDate: isoDay(invoice.dueDate),
      }),
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Invoice ${invoice.number} email failed:`, message);
    throw new HttpError(
      502,
      `${describeFailure('EMAIL', message)}. ${invoice.status === 'DRAFT' ? 'The invoice is still a draft.' : 'Nothing was changed.'}`,
    );
  }

  await prisma.invoice.updateMany({
    where: { id, lawyerId, status: { in: ['DRAFT', 'SENT'] } },
    data: { status: 'SENT', sentAt: new Date() },
  });
  return getInvoice(prisma, lawyerId, id);
}
