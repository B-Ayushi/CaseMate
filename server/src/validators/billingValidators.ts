import { z } from 'zod';
import { hourlyRateSchema, isoDaySchema, optionalText, requiredText } from './common.js';

// These rules are mirrored in the client's billing forms.

export const minutesSchema = z
  .number({ error: 'Enter the time spent' })
  .int({ error: 'Enter whole minutes' })
  .min(1, { error: 'Enter at least 1 minute' })
  .max(24 * 60, { error: 'One entry can be at most 24 hours' });

const timeEntryFields = {
  workDate: isoDaySchema,
  minutes: minutesSchema,
  description: requiredText(1000, 'Describe the work done'),
};

export const createTimeEntrySchema = z.object({
  caseId: z.cuid({ error: 'Choose a case' }),
  ...timeEntryFields,
});

// The case and the rate are fixed once an entry exists; the amount follows the minutes.
export const updateTimeEntrySchema = z.object(timeEntryFields);

const optionalCuid = z.cuid().optional();

export const timeEntryListQuerySchema = z
  .object({
    clientId: optionalCuid,
    caseId: optionalCuid,
    from: isoDaySchema.optional(),
    to: isoDaySchema.optional(),
    billed: z.enum(['all', 'billed', 'unbilled']).default('all'),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    error: 'The end date is before the start date',
  });

export const rateQuerySchema = z.object({ caseId: z.cuid({ error: 'Choose a case' }) });

export const createInvoiceSchema = z
  .object({
    clientId: z.cuid({ error: 'Choose a client' }),
    timeEntryIds: z
      .array(z.cuid(), { error: 'Choose the time entries to bill' })
      .min(1, { error: 'Choose at least one time entry' })
      .max(500, { error: 'One invoice can have at most 500 entries' }),
    issueDate: isoDaySchema.optional(),
    dueDate: isoDaySchema.optional(),
    notes: optionalText(2000, 'Notes'),
  })
  .refine((v) => !v.issueDate || !v.dueDate || v.dueDate >= v.issueDate, {
    path: ['dueDate'],
    error: 'The due date cannot be before the issue date',
  });

export const updateInvoiceSchema = z.object({
  dueDate: isoDaySchema,
  notes: optionalText(2000, 'Notes'),
});

export const invoiceListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE']).optional(),
  clientId: optionalCuid,
});

export const monthQuerySchema = z.object({
  month: z.string({ error: 'Choose a month' }).regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, {
    error: 'Choose a month in the form YYYY-MM, for example 2026-10',
  }),
});

export const billingSettingsSchema = z.object({ defaultHourlyRatePaise: hourlyRateSchema });

export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;
export type TimeEntryListQuery = z.infer<typeof timeEntryListQuerySchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
