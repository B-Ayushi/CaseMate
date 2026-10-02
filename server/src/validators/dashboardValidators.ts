import { z } from 'zod';

export const calendarQuerySchema = z.object({
  month: z.string({ error: 'Choose a month' }).regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, {
    error: 'Choose a month in the form YYYY-MM, for example 2026-10',
  }),
});
