import { z } from 'zod';
import { isoDaySchema, optionalText, requiredText, timeOfDaySchema } from './common.js';

// These rules are mirrored in the client forms.

// A per-case reminder setting: null means "use my default".
const override = z
  .boolean()
  .nullish()
  .transform((value) => value ?? null);

export const hearingSlotSchema = z.object({
  date: isoDaySchema,
  time: timeOfDaySchema,
  purpose: optionalText(191, 'Purpose'),
  notes: optionalText(5000, 'Notes'),
});

const caseFields = {
  clientId: z.cuid({ error: 'Choose a client' }),
  title: requiredText(191, 'Enter a title, for example Gupta vs. Mehta Builders'),
  caseNumber: requiredText(100, 'Enter the case number'),
  caseType: optionalText(191, 'Case type'),
  courtName: requiredText(191, 'Enter the court'),
  courtroom: optionalText(100, 'Courtroom'),
  judge: optionalText(191, 'Judge'),
  opposingParty: optionalText(191, 'Opposing party'),
  opposingCounsel: optionalText(191, 'Opposing counsel'),
  notes: optionalText(5000, 'Notes'),
  emailReminderOverride: override,
  smsReminderOverride: override,
  dayBeforeReminderOverride: override,
  twoHourReminderOverride: override,
};

// A new case comes with its first hearing, as on the Add Case form.
export const createCaseSchema = z.object({
  ...caseFields,
  firstHearing: hearingSlotSchema,
});

export const updateCaseSchema = z.object({
  ...caseFields,
  status: z.enum(['ACTIVE', 'CLOSED'], { error: 'Choose a status' }),
});

export const caseListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED', 'ALL']).default('ACTIVE'),
  search: z.string().trim().max(100).optional(),
  clientId: z.cuid().optional(),
});

export const outcomeSchema = z
  .object({
    outcome: z.enum(['ADJOURNED', 'HEARD', 'ORDER_RESERVED', 'DISPOSED', 'OTHER'], {
      error: 'Choose what happened',
    }),
    outcomeNotes: optionalText(5000, 'Notes'),
    timeSpentMinutes: z
      .number({ error: 'Enter the time spent in minutes' })
      .int({ error: 'Enter whole minutes' })
      .min(0, { error: 'Time spent cannot be negative' })
      .max(24 * 60, { error: 'Time spent cannot be more than 24 hours' })
      .nullish()
      .transform((value) => value ?? null),
    nextHearing: hearingSlotSchema.nullish().transform((value) => value ?? null),
    closeCase: z.boolean().default(false),
  })
  .refine((v) => !(v.closeCase && v.nextHearing), {
    path: ['closeCase'],
    error: 'A case with a next hearing cannot be closed',
  });

export const hearingRangeQuerySchema = z
  .object({ from: isoDaySchema, to: isoDaySchema })
  .refine((v) => v.from <= v.to, { path: ['to'], error: 'The end date is before the start date' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 62, {
    path: ['to'],
    error: 'Choose a range of at most two months',
  });

export type CreateCaseBody = z.infer<typeof createCaseSchema>;
export type UpdateCaseBody = z.infer<typeof updateCaseSchema>;
export type HearingSlot = z.infer<typeof hearingSlotSchema>;
export type OutcomeBody = z.infer<typeof outcomeSchema>;
