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
    hourlyRate: optionalRupeesField,
  })
  .refine((v) => v.preferredContact !== 'EMAIL' || v.email !== '', {
    path: ['email'],
    error: 'Add an email address, or choose another way to contact this client',
  });

export type SignupForm = z.infer<typeof signupSchema>;
export type LoginForm = z.infer<typeof loginSchema>;
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;
export type ClientForm = z.infer<typeof clientFormSchema>;
