// Every amount is an integer number of paise. These helpers are the only place amounts
// are calculated or turned into text on the server.

// The amount for `minutes` of work at an hourly rate, rounded to the nearest paisa.
export function amountForMinutes(minutes: number, ratePaise: number): number {
  return Math.round((minutes * ratePaise) / 60);
}

// "₹1,20,000" or "₹2,500.50": rupees with Indian digit grouping.
export function formatPaise(paise: number): string {
  const hasPaise = paise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

// "1.50" hours for 90 minutes.
export const formatHours = (minutes: number) => (minutes / 60).toFixed(2);
