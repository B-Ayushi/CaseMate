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
