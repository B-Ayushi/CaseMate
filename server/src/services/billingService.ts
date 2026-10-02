import type { PrismaClient } from '@prisma/client';
import { dateOnly, istDateString, istDayRange, monthDays } from '../lib/time.js';

// One month's billing, in IST calendar terms:
// - billed: invoices issued in the month that have gone to the client (sent or paid);
//   drafts are not billed yet
// - received: invoices marked paid during the month
// - outstanding: of the month's billed invoices, what is still unpaid, and how much of
//   that is past its due date
// - unbilled: time logged in the month that is on no invoice yet
export async function billingSummary(
  prisma: PrismaClient,
  lawyerId: string,
  month: string,
  now = new Date(),
) {
  const { first, last } = monthDays(month);
  const issuedInMonth = { gte: dateOnly(first), lte: dateOnly(last) };
  const today = dateOnly(istDateString(now));

  const [billed, received, outstanding, overdue, unbilled] = await Promise.all([
    prisma.invoice.aggregate({
      where: { lawyerId, status: { in: ['SENT', 'PAID'] }, issueDate: issuedInMonth },
      _sum: { totalPaise: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: {
        lawyerId,
        status: 'PAID',
        paidAt: { gte: istDayRange(first).start, lt: istDayRange(last).end },
      },
      _sum: { totalPaise: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { lawyerId, status: 'SENT', issueDate: issuedInMonth },
      _sum: { totalPaise: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { lawyerId, status: 'SENT', issueDate: issuedInMonth, dueDate: { lt: today } },
      _sum: { totalPaise: true },
    }),
    prisma.timeEntry.aggregate({
      where: { lawyerId, invoiceId: null, workDate: issuedInMonth },
      _sum: { amountPaise: true, minutes: true },
      _count: true,
    }),
  ]);

  return {
    month,
    billed: { paise: billed._sum.totalPaise ?? 0, invoices: billed._count },
    received: { paise: received._sum.totalPaise ?? 0, invoices: received._count },
    outstanding: {
      paise: outstanding._sum.totalPaise ?? 0,
      invoices: outstanding._count,
      overduePaise: overdue._sum.totalPaise ?? 0,
    },
    unbilled: {
      paise: unbilled._sum.amountPaise ?? 0,
      minutes: unbilled._sum.minutes ?? 0,
      entries: unbilled._count,
    },
  };
}
