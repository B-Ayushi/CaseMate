import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

// All dates are shown and entered in Indian Standard Time, whatever the device's zone.
export const IST = 'Asia/Kolkata';

type DateInput = Date | string;

const toDate = (value: DateInput) => (typeof value === 'string' ? new Date(value) : value);

export const formatIst = (value: DateInput, pattern: string) =>
  formatInTimeZone(toDate(value), IST, pattern);

// "Tue, 14 Oct 2026"
export const formatDay = (value: DateInput) => formatIst(value, 'EEE, d MMM yyyy');
// "10:30 AM"
export const formatTime = (value: DateInput) => formatIst(value, 'h:mm a');
// "Tue, 14 Oct 2026, 10:30 AM"
export const formatDateTime = (value: DateInput) => `${formatDay(value)}, ${formatTime(value)}`;

// DATE columns (calendar days) arrive as midnight UTC of the day; show them as that day.
export const formatCalendarDay = (value: DateInput) =>
  formatInTimeZone(toDate(value), 'UTC', 'd MMM yyyy');

// "yyyy-MM-dd" of today in IST, for date inputs.
export const todayIst = () => formatIst(new Date(), 'yyyy-MM-dd');

// Values for <input type="date"> and <input type="time"> from a stored instant.
export const toDateInput = (value: DateInput) => formatIst(value, 'yyyy-MM-dd');
export const toTimeInput = (value: DateInput) => formatIst(value, 'HH:mm');

// The instant for an IST date and time typed into the form.
export const istToUtc = (day: string, time: string) => fromZonedTime(`${day}T${time}:00`, IST);

export const addDaysToIsoDay = (day: string, days: number) =>
  formatInTimeZone(addDays(new Date(`${day}T00:00:00Z`), days), 'UTC', 'yyyy-MM-dd');

// Calendar days ("yyyy-MM-dd") and months ("yyyy-MM") are IST days already, so they are
// handled as plain dates with no time zone conversion.
const isoDayDate = (day: string) => new Date(`${day}T00:00:00Z`);

// Format an IST calendar day, e.g. formatIsoDay("2026-10-14", "EEE d MMM") = "Wed 14 Oct".
export const formatIsoDay = (day: string, pattern: string) =>
  formatInTimeZone(isoDayDate(day), 'UTC', pattern);

// "October 2026"
export const formatMonth = (month: string) => formatIsoDay(`${month}-01`, 'MMMM yyyy');

// The current IST month, "yyyy-MM".
export const thisMonthIst = () => formatIst(new Date(), 'yyyy-MM');

export function addMonths(month: string, months: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, monthNumber - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

// Every day of a month, in order.
export function daysOfMonth(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

// 0 for Monday through 6 for Sunday.
export const weekdayMondayFirst = (day: string) => (isoDayDate(day).getUTCDay() + 6) % 7;

// Matches "yyyy-MM" and "yyyy-MM-dd" values read from the address bar.
export const isMonth = (value: string | null): value is string =>
  !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export const isIsoDay = (value: string | null): value is string =>
  !!value && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);
