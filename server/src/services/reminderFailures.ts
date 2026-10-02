import type { ReminderChannel } from '@prisma/client';

// Turns the technical error stored on a failed reminder into one short sentence a
// lawyer can act on, for example "Email could not be sent: mail server connection
// failed". The full error is still kept on the reminder for troubleshooting.
const rules: { match: RegExp; email?: string; sms?: string; both?: string }[] = [
  { match: /not configured/i, both: 'sending is not set up yet (see server settings)' },
  { match: /interrupted/i, both: 'sending was interrupted when the server stopped' },
  { match: /not a valid Indian mobile number/i, sms: 'your mobile number is not valid' },
  {
    match: /certificate|self[- ]signed|\bTLS\b|\bSSL\b/i,
    email: 'the secure connection to the mail server failed',
    sms: 'the secure connection to the SMS service failed',
  },
  {
    match: /invalid login|EAUTH|authenticat|\b535\b|username and password|credentials/i,
    email: 'the mail server rejected the login',
    sms: 'the SMS service rejected the account details',
  },
  {
    match: /unverified|verified caller/i,
    sms: 'your number is not verified on the SMS trial account',
  },
  {
    match: /permission to send|geo.?permission|not enabled for the region/i,
    sms: 'sending to Indian numbers is not enabled on the SMS account',
  },
  {
    match: /recipient|mailbox|EENVELOPE|no recipients|address rejected/i,
    email: 'your email address was rejected',
  },
  {
    match:
      /ECONNREFUSED|ECONNRESET|ECONNECTION|ETIMEDOUT|ESOCKET|ENOTFOUND|EAI_AGAIN|timed? ?out|greeting never received|getaddrinfo|socket|connect/i,
    email: 'mail server connection failed',
    sms: 'the SMS service could not be reached',
  },
];

export function describeFailure(channel: ReminderChannel, lastError: string | null): string {
  const label = channel === 'EMAIL' ? 'Email' : 'SMS';
  const error = lastError ?? '';
  for (const rule of rules) {
    if (!rule.match.test(error)) continue;
    const text = rule.both ?? (channel === 'EMAIL' ? rule.email : rule.sms);
    if (text) return `${label} could not be sent: ${text}`;
  }
  return channel === 'EMAIL'
    ? 'Email could not be sent: the mail server returned an error'
    : 'SMS could not be sent: the SMS service returned an error';
}
