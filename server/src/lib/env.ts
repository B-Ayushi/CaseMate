import 'dotenv/config';
import { z } from 'zod';

const required = (name: string) =>
  z
    .string({ error: `${name} is required (see server/.env.example)` })
    .trim()
    .min(1, { error: `${name} is required (see server/.env.example)` });

// Empty values in .env count as "not set".
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET').min(32, {
    error: 'JWT_SECRET must be at least 32 characters long',
  }),
  CLIENT_URL: z.url().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  // Email and SMS may be left unset while developing. Sends then fail with a clear
  // "not configured" error instead of pretending to succeed.
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  EMAIL_FROM: optional,
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_FROM_NUMBER: optional,
  ENABLE_SCHEDULER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid server environment:\n${problems}`);
  }
  return result.data;
}

export const env = loadEnv();
