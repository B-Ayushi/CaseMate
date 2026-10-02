import { z } from 'zod';

// These rules are mirrored in the client forms.

export const emailSchema = z
  .string({ error: 'Enter your email address' })
  .trim()
  .toLowerCase()
  .max(191, { error: 'Email address is too long' })
  .pipe(z.email({ error: 'Enter a valid email address' }));

// Indian mobile numbers: 10 digits starting 6-9, optionally written with +91, 91 or 0 in
// front and with spaces or dashes. Stored as +91XXXXXXXXXX.
const INDIAN_MOBILE = /^(?:\+91|91|0)?([6-9]\d{9})$/;

export const indianMobileSchema = z
  .string({ error: 'Enter your mobile number' })
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => INDIAN_MOBILE.test(value), {
    error: 'Enter a valid Indian mobile number, for example 98765 43210',
  })
  .transform((value) => `+91${INDIAN_MOBILE.exec(value)![1]}`);

// bcrypt only uses the first 72 bytes of a password, so longer ones are rejected rather
// than silently truncated.
export const newPasswordSchema = z
  .string({ error: 'Enter a password' })
  .min(8, { error: 'Password must be at least 8 characters' })
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
    error: 'Password is too long (maximum 72 bytes)',
  })
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    error: 'Password must include at least one letter and one number',
  });

export const signupSchema = z.object({
  name: z
    .string({ error: 'Enter your name' })
    .trim()
    .min(1, { error: 'Enter your name' })
    .max(100, { error: 'Name is too long' }),
  email: emailSchema,
  phone: indianMobileSchema,
  barCouncilNumber: z
    .string({ error: 'Enter your Bar Council enrolment number' })
    .trim()
    .min(1, { error: 'Enter your Bar Council enrolment number' })
    .max(50, { error: 'Enrolment number is too long' }),
  password: newPasswordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Enter your password' })
    .min(1, { error: 'Enter your password' })
    .max(200),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z
    .string({ error: 'Reset link is missing its token' })
    .trim()
    .min(1, { error: 'Reset link is missing its token' })
    .max(200),
  password: newPasswordSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
