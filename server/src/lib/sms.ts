import twilio from 'twilio';
import { toIndianE164 } from './phone.js';

// Every SMS gateway plugs in behind this interface. Twilio is the one in use; an Indian
// gateway such as MSG91 is added by writing another provider and choosing it in
// createSmsProviderFromEnv. The reminder engine only ever sees SmsProvider.
export interface SmsProvider {
  readonly name: string;
  // `to` is always an Indian mobile number in +91XXXXXXXXXX form.
  send(to: string, body: string): Promise<void>;
}

export class SmsNotConfiguredError extends Error {
  constructor() {
    super(
      'SMS is not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in server/.env.',
    );
    this.name = 'SmsNotConfiguredError';
  }
}

export class InvalidPhoneNumberError extends Error {
  constructor(value: string) {
    super(`"${value}" is not a valid Indian mobile number, so no SMS could be sent.`);
    this.name = 'InvalidPhoneNumberError';
  }
}

// Normalises the number to +91 form, then hands the message to the provider.
export async function sendSms(provider: SmsProvider, to: string, body: string): Promise<void> {
  const number = toIndianE164(to);
  if (!number) throw new InvalidPhoneNumberError(to);
  await provider.send(number, body);
}

export function createTwilioProvider(settings: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}): SmsProvider {
  const client = twilio(settings.accountSid, settings.authToken);
  return {
    name: 'twilio',
    async send(to, body) {
      await client.messages.create({ to, from: settings.fromNumber, body });
    },
  };
}

// Used when SMS settings are missing: every send fails with a clear reason.
export function createUnconfiguredSmsProvider(): SmsProvider {
  return {
    name: 'unconfigured',
    async send() {
      throw new SmsNotConfiguredError();
    },
  };
}

export function createSmsProviderFromEnv(env: {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}): SmsProvider {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.warn(
      'SMS is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in server/.env). ' +
        'SMS reminders will fail and be marked FAILED until it is.',
    );
    return createUnconfiguredSmsProvider();
  }
  return createTwilioProvider({
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    fromNumber: TWILIO_FROM_NUMBER,
  });
}
