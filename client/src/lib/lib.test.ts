import { describe, expect, it } from 'vitest';
import { formatCalendarDay, formatDateTime, istToUtc, toDateInput, toTimeInput } from './dates';
import { safeNext } from './forms';
import { formatPaise, paiseToRupeesInput, rupeesToPaise } from './money';
import { clientFormSchema, signupSchema } from './validation';

describe('money', () => {
  it('formats paise as rupees with Indian digit grouping', () => {
    expect(formatPaise(12_000_000)).toBe('₹1,20,000');
    expect(formatPaise(250_050)).toBe('₹2,500.50');
    expect(formatPaise(0)).toBe('₹0');
    expect(formatPaise(1_00_00_000_00)).toBe('₹1,00,00,000');
  });

  it('parses typed rupee amounts into paise without float errors', () => {
    expect(rupeesToPaise('1,20,000')).toBe(12_000_000);
    expect(rupeesToPaise('₹ 2500.5')).toBe(250_050);
    expect(rupeesToPaise('0.29')).toBe(29);
    expect(rupeesToPaise('19.99')).toBe(1999);
    expect(rupeesToPaise('-5')).toBeNull();
    expect(rupeesToPaise('2.505')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });

  it('round-trips amounts for form inputs', () => {
    expect(paiseToRupeesInput(250_050)).toBe('2500.50');
    expect(paiseToRupeesInput(250_000)).toBe('2500');
    expect(paiseToRupeesInput(null)).toBe('');
  });
});

describe('dates are always shown in IST', () => {
  it('formats a UTC instant as IST wall-clock time', () => {
    // 05:00 UTC is 10:30 IST.
    expect(formatDateTime('2026-10-14T05:00:00.000Z')).toBe('Wed, 14 Oct 2026, 10:30 AM');
    // 20:00 UTC on the 13th is already the 14th in IST.
    expect(toDateInput('2026-10-13T20:00:00.000Z')).toBe('2026-10-14');
    expect(toTimeInput('2026-10-13T20:00:00.000Z')).toBe('01:30');
  });

  it('turns IST form input into the right UTC instant', () => {
    expect(istToUtc('2026-10-14', '10:30').toISOString()).toBe('2026-10-14T05:00:00.000Z');
  });

  it('shows DATE columns as the stored calendar day', () => {
    expect(formatCalendarDay('2026-10-31T00:00:00.000Z')).toBe('31 Oct 2026');
  });
});

describe('validation mirrors the server rules', () => {
  const signup = {
    name: 'A',
    email: 'a@example.com',
    phone: '+91 98765-43210',
    barCouncilNumber: 'MAH/1/2015',
    password: 'abcdefg1',
  };

  it('accepts a valid signup and Indian mobile formats', () => {
    expect(signupSchema.safeParse(signup).success).toBe(true);
    expect(signupSchema.safeParse({ ...signup, phone: '09876543210' }).success).toBe(true);
  });

  it('rejects weak passwords and non-mobile numbers', () => {
    expect(signupSchema.safeParse({ ...signup, password: 'abcdefgh' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...signup, password: 'abc1' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...signup, phone: '5876543210' }).success).toBe(false);
  });

  it('needs an email when email is the preferred contact', () => {
    const client = {
      name: 'R',
      phone: '9876543210',
      email: '',
      address: '',
      preferredContact: 'EMAIL' as const,
      languages: '',
      hourlyRate: '',
    };
    const result = clientFormSchema.safeParse(client);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['email']);
  });
});

describe('safeNext', () => {
  it('only allows paths inside the app', () => {
    expect(safeNext('/clients/abc')).toBe('/clients/abc');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
