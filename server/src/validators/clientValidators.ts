import { z } from 'zod';
import { emailSchema, indianMobileSchema } from './authValidators.js';
import { optionalText, paiseSchema, requiredText } from './common.js';

// These rules are mirrored in the client forms.

export const clientBodySchema = z
  .object({
    name: requiredText(191, "Enter the client's name"),
    phone: indianMobileSchema,
    email: z
      .union([z.literal(''), emailSchema])
      .nullish()
      .transform((value) => (value ? value : null)),
    address: optionalText(1000, 'Address'),
    preferredContact: z
      .enum(['PHONE', 'WHATSAPP', 'EMAIL'], {
        error: 'Choose how the client prefers to be contacted',
      })
      .default('PHONE'),
    languages: optionalText(191, 'Languages'),
    hourlyRatePaise: paiseSchema.nullish().transform((value) => value ?? null),
  })
  .refine((client) => client.preferredContact !== 'EMAIL' || client.email !== null, {
    path: ['email'],
    error: 'Add an email address, or choose another way to contact this client',
  });

export const clientListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});

export const clientNoteBodySchema = z.object({
  text: requiredText(5000, 'Write the note'),
  notedAt: z.iso
    .datetime({ offset: true, error: 'Enter a valid date and time' })
    .optional()
    .transform((value) => (value ? new Date(value) : new Date())),
});

export const clientNoteParamsSchema = z.object({
  id: z.cuid({ error: 'Not found' }),
  noteId: z.cuid({ error: 'Not found' }),
});

export type ClientBody = z.infer<typeof clientBodySchema>;
