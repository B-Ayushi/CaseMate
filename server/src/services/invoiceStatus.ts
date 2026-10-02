import type { InvoiceStatus } from '@prisma/client';
import { istDateString } from '../lib/time.js';

export type InvoiceDisplayStatus = InvoiceStatus | 'OVERDUE';

// Overdue is not stored. An invoice is overdue when it has been sent, is not paid, and
// its due date (an IST calendar day) is before today in IST. A draft has not been issued
// yet, so it is never overdue.
export function isOverdue(
  invoice: { status: InvoiceStatus; dueDate: Date },
  now: Date = new Date(),
): boolean {
  return (
    invoice.status === 'SENT' && invoice.dueDate.toISOString().slice(0, 10) < istDateString(now)
  );
}

export function invoiceDisplayStatus(
  invoice: { status: InvoiceStatus; dueDate: Date },
  now: Date = new Date(),
): InvoiceDisplayStatus {
  return isOverdue(invoice, now) ? 'OVERDUE' : invoice.status;
}
