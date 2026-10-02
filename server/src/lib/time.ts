import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

// Every date the lawyer sees or types is in Indian Standard Time. Timestamps are stored
// in UTC; calendar days (DATE columns) are stored as midnight UTC of the IST day.
export const APP_TIMEZONE = 'Asia/Kolkata';

// "yyyy-MM-dd" of the IST calendar day that contains `instant`.
export function istDateString(instant: Date): string {
  return formatInTimeZone(instant, APP_TIMEZONE, 'yyyy-MM-dd');
}

// A DATE column value for an IST calendar day given as "yyyy-MM-dd".
export function dateOnly(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

// Today's IST calendar day as a DATE column value.
export function istToday(now: Date = new Date()): Date {
  return dateOnly(istDateString(now));
}

// The UTC instant of a wall-clock time in IST, e.g. ("2026-10-14", "10:30").
export function istDateTimeToUtc(isoDay: string, time: string): Date {
  return fromZonedTime(`${isoDay}T${time}:00`, APP_TIMEZONE);
}

// Start (inclusive) and end (exclusive) UTC instants of an IST calendar day.
export function istDayRange(isoDay: string): { start: Date; end: Date } {
  const start = istDateTimeToUtc(isoDay, '00:00');
  return { start, end: addDays(start, 1) };
}

export function formatIst(instant: Date, pattern: string): string {
  return formatInTimeZone(instant, APP_TIMEZONE, pattern);
}
