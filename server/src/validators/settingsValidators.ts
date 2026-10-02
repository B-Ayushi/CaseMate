import { z } from 'zod';
import {
  barCouncilNumberSchema,
  indianMobileSchema,
  lawyerNameSchema,
  newPasswordSchema,
} from './authValidators.js';

// These rules are mirrored in the client's Settings forms.

const atLeastOneField = (value: object) =>
  Object.values(value).some((field) => field !== undefined);

// Email is the login and cannot be changed here.
export const profileSchema = z
  .object({
    name: lawyerNameSchema,
    phone: indianMobileSchema,
    barCouncilNumber: barCouncilNumberSchema,
  })
  .partial()
  .refine(atLeastOneField, { error: 'Nothing to update' });

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ error: 'Enter your current password' })
    .min(1, { error: 'Enter your current password' })
    .max(200),
  newPassword: newPasswordSchema,
});

// "HH:mm" in IST, on the quarter hour.
export const summaryTimeSchema = z
  .string({ error: 'Choose a time' })
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, {
    error: 'Choose a time on the quarter hour, for example 07:00 or 07:15',
  });

export const reminderPrefsSchema = z
  .object({
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    dayBeforeEnabled: z.boolean(),
    twoHourEnabled: z.boolean(),
    dailySummaryEnabled: z.boolean(),
    dailySummaryTime: summaryTimeSchema,
    missingOutcomeNudgeEnabled: z.boolean(),
  })
  .partial()
  .refine(atLeastOneField, { error: 'Nothing to update' });

export const deleteAccountSchema = z.object({
  email: z
    .string({ error: 'Type your account email' })
    .trim()
    .toLowerCase()
    .min(1, { error: 'Type your account email' })
    .max(191),
  password: z
    .string({ error: 'Enter your password' })
    .min(1, { error: 'Enter your password' })
    .max(200),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ReminderPrefsInput = z.infer<typeof reminderPrefsSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
