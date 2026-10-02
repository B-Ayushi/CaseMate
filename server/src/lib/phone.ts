// Indian mobile numbers: 10 digits starting 6-9, optionally written with +91, 91 or 0 in
// front and with spaces or dashes. The one stored and dialled form is
// +91XXXXXXXXXX.
const INDIAN_MOBILE = /^(?:\+91|91|0)?([6-9]\d{9})$/;

// The +91 form of an Indian mobile number, or null if it is not one.
export function toIndianE164(value: string): string | null {
  const match = INDIAN_MOBILE.exec(value.replace(/[\s-]/g, ''));
  return match ? `+91${match[1]}` : null;
}
