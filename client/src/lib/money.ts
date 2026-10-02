// Amounts are integer paise everywhere; they are shown as rupees with Indian digit
// grouping, e.g. 12000000 paise -> "₹1,20,000".

export function formatPaise(paise: number): string {
  const hasPaise = paise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

const RUPEES = /^\d{1,8}(\.\d{1,2})?$/;

// Parses what a lawyer types ("1,20,000", "₹ 2500.50") into paise, or null if it is not
// a valid amount. Works on the digits directly so no floating-point rounding creeps in.
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!RUPEES.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

// For pre-filling an amount input: 250050 -> "2500.50", 250000 -> "2500".
export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  const whole = Math.floor(paise / 100);
  const fraction = paise % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}
