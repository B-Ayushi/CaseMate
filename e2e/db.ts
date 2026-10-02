import { PrismaClient } from '@prisma/client';
import { E2E_DATABASE_URL } from '../playwright.config';

// Direct access to the test database, for set-up the app deliberately does not allow
// (such as a hearing that already happened) and for checking what was stored.
export const db = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });

const DAY = 24 * 60 * 60 * 1000;

// "yyyy-MM-dd" of the IST day `days` from now.
export function istDay(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.now() + days * DAY),
  );
}

// The app's "EEE, d MMM yyyy" label for an IST day, e.g. "Wed, 14 Oct 2026".
export function dayLabel(isoDay: string): string {
  const date = new Date(`${isoDay}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
  return `${part({ weekday: 'short' })}, ${part({ day: 'numeric' })} ${part({ month: 'short' })} ${part({ year: 'numeric' })}`;
}
