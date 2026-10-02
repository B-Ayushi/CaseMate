import { z } from 'zod';
import { rupeesToPaise } from './money';

// These mirror the server's zod rules (server/src/validators) with the same messages, so
// the lawyer sees the same feedback before and after a request. The server always
// re-validates.

export const emailField = z
  .string()
  .trim()
  .min(1, { error: 'Enter your email address' })
  .max(191, { error: 'Email address is too long' })
  .pipe(z.email({ error: 'Enter a valid email address' }));

const INDIAN_MOBILE = /^(?:\+91|91|0)?[6-9]\d{9}$/;

export const indianMobileField = z
  .string()
  .trim()
  .refine((value) => INDIAN_MOBILE.test(value.replace(/[\s-]/g, '')), {
    error: 'Enter a valid Indian mobile number, for example 98765 43210',
  });

export const newPasswordField = z
  .string()
  .min(8, { error: 'Password must be at least 8 characters' })
  .refine((value) => new TextEncoder().encode(value).length <= 72, {
    error: 'Password is too long (maximum 72 bytes)',
  })
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    error: 'Password must include at least one letter and one number',
  });

export const requiredText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .min(1, { error: message })
    .max(max, { error: `Too long (maximum ${max} characters)` });

export const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} is too long (maximum ${max} characters)` });

// An optional rupee amount typed as text; empty is allowed.
export const optionalRupeesField = z
  .string()
  .trim()
  .refine((value) => value === '' || rupeesToPaise(value) !== null, {
    error: 'Enter an amount in rupees, for example 2500 or 2,500.50',
  });

export const requiredRupeesField = z
  .string()
  .trim()
  .min(1, { error: 'Enter an amount' })
  .refine((value) => rupeesToPaise(value) !== null, {
    error: 'Enter an amount in rupees, for example 2500 or 2,500.50',
  });

// Hourly rates: the same ceiling as the server (₹5,00,000 an hour).
export const MAX_HOURLY_RATE_PAISE = 50_000_000;
const RATE_TOO_HIGH = 'Rate can be at most ₹5,00,000 an hour';

export const optionalHourlyRateField = optionalRupeesField.refine(
  (value) => value === '' || (rupeesToPaise(value) ?? 0) <= MAX_HOURLY_RATE_PAISE,
  { error: RATE_TOO_HIGH },
);

export const hourlyRateField = requiredRupeesField.refine(
  (value) => (rupeesToPaise(value) ?? 0) <= MAX_HOURLY_RATE_PAISE,
  { error: RATE_TOO_HIGH },
);

export const signupSchema = z.object({
  name: requiredText(100, 'Enter your name'),
  email: emailField,
  phone: indianMobileField,
  barCouncilNumber: requiredText(50, 'Enter your Bar Council enrolment number'),
  password: newPasswordField,
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, { error: 'Enter your password' }),
});

export const forgotPasswordSchema = z.object({ email: emailField });

export const resetPasswordSchema = z
  .object({
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    error: 'The two passwords do not match',
  });

export const clientFormSchema = z
  .object({
    name: requiredText(191, "Enter the client's name"),
    phone: indianMobileField,
    email: z
      .string()
      .trim()
      .refine((value) => value === '' || z.email().safeParse(value).success, {
        error: 'Enter a valid email address',
      }),
    address: optionalText(1000, 'Address'),
    preferredContact: z.enum(['PHONE', 'WHATSAPP', 'EMAIL']),
    languages: optionalText(191, 'Languages'),
    hourlyRate: optionalHourlyRateField,
  })
  .refine((v) => v.preferredContact !== 'EMAIL' || v.email !== '', {
    path: ['email'],
    error: 'Add an email address, or choose another way to contact this client',
  });

// Settings

export const profileFormSchema = z.object({
  name: requiredText(100, 'Enter your name'),
  phone: indianMobileField,
  barCouncilNumber: requiredText(50, 'Enter your Bar Council enrolment number'),
});

export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, { error: 'Enter your current password' }),
    newPassword: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    error: 'The two passwords do not match',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    error: 'Choose a password different from your current one',
  });

export const SUMMARY_TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;

export const reminderPrefsFormSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  dayBeforeEnabled: z.boolean(),
  twoHourEnabled: z.boolean(),
  dailySummaryEnabled: z.boolean(),
  dailySummaryTime: z.string().regex(SUMMARY_TIME, {
    error: 'Choose a time on the quarter hour, for example 07:00 or 07:15',
  }),
  missingOutcomeNudgeEnabled: z.boolean(),
});

export const deleteAccountFormSchema = z.object({
  email: z.string().trim().min(1, { error: 'Type your account email' }),
  password: z.string().min(1, { error: 'Enter your password' }),
});

export type ProfileForm = z.infer<typeof profileFormSchema>;
export type ChangePasswordForm = z.infer<typeof changePasswordFormSchema>;
export type ReminderPrefsForm = z.infer<typeof reminderPrefsFormSchema>;
export type DeleteAccountForm = z.infer<typeof deleteAccountFormSchema>;

export type SignupForm = z.infer<typeof signupSchema>;
export type LoginForm = z.infer<typeof loginSchema>;
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;
export type ClientForm = z.infer<typeof clientFormSchema>;

// Cases and hearings

export const hearingSlotForm = z.object({
  date: z.string().min(1, { error: 'Choose a date' }),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Enter a valid time, for example 10:30' }),
  purpose: optionalText(191, 'Purpose'),
  notes: optionalText(5000, 'Notes'),
});

// A per-case reminder choice: follow the lawyer's default, or force on or off.
export const overrideChoice = z.enum(['default', 'on', 'off']);

export const caseFormSchema = z.object({
  clientId: z.string().min(1, { error: 'Choose a client' }),
  title: requiredText(191, 'Enter a title, for example Gupta vs. Mehta Builders'),
  caseNumber: requiredText(100, 'Enter the case number'),
  caseType: optionalText(191, 'Case type'),
  courtName: requiredText(191, 'Enter the court'),
  courtroom: optionalText(100, 'Courtroom'),
  judge: optionalText(191, 'Judge'),
  opposingParty: optionalText(191, 'Opposing party'),
  opposingCounsel: optionalText(191, 'Opposing counsel'),
  notes: optionalText(5000, 'Notes'),
  emailReminderOverride: overrideChoice,
  smsReminderOverride: overrideChoice,
  dayBeforeReminderOverride: overrideChoice,
  twoHourReminderOverride: overrideChoice,
});

export const newCaseFormSchema = caseFormSchema.extend({ firstHearing: hearingSlotForm });
export const editCaseFormSchema = caseFormSchema.extend({ status: z.enum(['ACTIVE', 'CLOSED']) });

const wholeNumber = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= max), {
      error: `${label} must be a whole number up to ${max}`,
    });

export const outcomeFormSchema = z
  .object({
    outcome: z.enum(['ADJOURNED', 'HEARD', 'ORDER_RESERVED', 'DISPOSED', 'OTHER'], {
      error: 'Choose what happened',
    }),
    outcomeNotes: optionalText(5000, 'Notes'),
    hours: wholeNumber('Hours', 24),
    minutes: wholeNumber('Minutes', 59),
    hasNextDate: z.boolean(),
    nextHearing: z.object({
      date: z.string(),
      time: z.string(),
      purpose: optionalText(191, 'Purpose'),
    }),
    closeCase: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.hasNextDate) {
      if (!v.nextHearing.date) {
        ctx.addIssue({
          code: 'custom',
          path: ['nextHearing', 'date'],
          message: 'Choose the next date',
        });
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.nextHearing.time)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nextHearing', 'time'],
          message: 'Enter a valid time, for example 10:30',
        });
      }
    }
  });

export type HearingSlotForm = z.infer<typeof hearingSlotForm>;
export type NewCaseForm = z.infer<typeof newCaseFormSchema>;
export type EditCaseForm = z.infer<typeof editCaseFormSchema>;
export type OutcomeForm = z.infer<typeof outcomeFormSchema>;

// Billing

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Hours and minutes typed separately; together at least 1 minute and at most 24 hours.
export const timeEntryFormSchema = z
  .object({
    caseId: z.string().min(1, { error: 'Choose a case' }),
    workDate: z.string().regex(ISO_DAY, { error: 'Enter a valid date' }),
    hours: wholeNumber('Hours', 24),
    minutes: wholeNumber('Minutes', 59),
    description: requiredText(1000, 'Describe the work done'),
  })
  .superRefine((v, ctx) => {
    const total = Number(v.hours || 0) * 60 + Number(v.minutes || 0);
    if (total < 1) {
      ctx.addIssue({ code: 'custom', path: ['minutes'], message: 'Enter the time spent' });
    } else if (total > 24 * 60) {
      ctx.addIssue({
        code: 'custom',
        path: ['hours'],
        message: 'One entry can be at most 24 hours',
      });
    }
  });

export const timeTotalMinutes = (v: { hours: string; minutes: string }) =>
  Number(v.hours || 0) * 60 + Number(v.minutes || 0);

export const invoiceFormSchema = z
  .object({
    clientId: z.string().min(1, { error: 'Choose a client' }),
    timeEntryIds: z.array(z.string()).min(1, { error: 'Choose at least one time entry' }),
    issueDate: z.string().regex(ISO_DAY, { error: 'Enter a valid date' }),
    dueDate: z.string().regex(ISO_DAY, { error: 'Enter a valid date' }),
    notes: optionalText(2000, 'Notes'),
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    path: ['dueDate'],
    error: 'The due date cannot be before the issue date',
  });

export const billingSettingsFormSchema = z.object({ defaultRate: hourlyRateField });

export const editOutcomeFormSchema = z.object({
  outcome: z.enum(['ADJOURNED', 'HEARD', 'ORDER_RESERVED', 'DISPOSED', 'OTHER'], {
    error: 'Choose what happened',
  }),
  outcomeNotes: optionalText(5000, 'Notes'),
  hours: wholeNumber('Hours', 24),
  minutes: wholeNumber('Minutes', 59),
});

export type TimeEntryForm = z.infer<typeof timeEntryFormSchema>;
export type InvoiceForm = z.infer<typeof invoiceFormSchema>;
export type BillingSettingsForm = z.infer<typeof billingSettingsFormSchema>;
export type EditOutcomeForm = z.infer<typeof editOutcomeFormSchema>;
