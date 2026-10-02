import { z } from 'zod';
import { HttpError } from '../lib/httpError.js';

export const idParamSchema = z.object({
  id: z.cuid(),
});

// URL parameters name records. One that cannot be valid can never be found, so it gets
// the same 404 as a record that does not exist or belongs to someone else.
export function parseParams<T extends z.ZodType>(schema: T, params: unknown): z.infer<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new HttpError(404, 'Not found.');
  }
  return result.data;
}

// Optional free text: trimmed, and an empty value is stored as null.
export function optionalText(max: number, label = 'This field') {
  return z
    .string()
    .trim()
    .max(max, { error: `${label} is too long (maximum ${max} characters)` })
    .nullish()
    .transform((value) => (value ? value : null));
}

export function requiredText(max: number, message: string) {
  return z
    .string({ error: message })
    .trim()
    .min(1, { error: message })
    .max(max, { error: `Too long (maximum ${max} characters)` });
}

// Amounts in paise. The upper bound keeps every value inside a 32-bit column.
export const paiseSchema = z
  .number({ error: 'Enter an amount' })
  .int({ error: 'Amount must be in whole paise' })
  .min(0, { error: 'Amount cannot be negative' })
  .max(2_000_000_000, { error: 'Amount is too large' });

// An hourly rate in paise. The ceiling (₹5,00,000 an hour) keeps a full day's work at
// that rate, and so every stored amount, inside a 32-bit column.
export const MAX_HOURLY_RATE_PAISE = 50_000_000;
export const hourlyRateSchema = z
  .number({ error: 'Enter an hourly rate' })
  .int({ error: 'Rate must be in whole paise' })
  .min(0, { error: 'Rate cannot be negative' })
  .max(MAX_HOURLY_RATE_PAISE, { error: 'Rate can be at most ₹5,00,000 an hour' });

// "yyyy-MM-dd" calendar day (interpreted in IST).
export const isoDaySchema = z.iso.date({ error: 'Enter a valid date' });

// "HH:mm" 24-hour time (interpreted in IST).
export const timeOfDaySchema = z
  .string({ error: 'Enter a time' })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Enter a valid time, for example 10:30' });
