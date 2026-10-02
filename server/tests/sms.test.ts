import { describe, expect, it } from 'vitest';
import { toIndianE164 } from '../src/lib/phone.js';
import {
  createUnconfiguredSmsProvider,
  InvalidPhoneNumberError,
  sendSms,
  SmsNotConfiguredError,
  type SmsProvider,
} from '../src/lib/sms.js';

function recorder() {
  const sent: { to: string; body: string }[] = [];
  const provider: SmsProvider = {
    name: 'recorder',
    async send(to, body) {
      sent.push({ to, body });
    },
  };
  return { provider, sent };
}

describe('Indian mobile numbers', () => {
  it.each(['9822012345', '09822012345', '919822012345', '+919822012345', '+91 98220-12345'])(
    'normalises %s to +91 form',
    (value) => {
      expect(toIndianE164(value)).toBe('+919822012345');
    },
  );

  it.each(['', '12345', '5822012345', '+14155550123', '98220123456'])('rejects %s', (value) => {
    expect(toIndianE164(value)).toBeNull();
  });
});

describe('sendSms', () => {
  it('hands the provider the +91 number', async () => {
    const { provider, sent } = recorder();
    await sendSms(provider, '098220 12345', 'Hearing tomorrow');
    expect(sent).toEqual([{ to: '+919822012345', body: 'Hearing tomorrow' }]);
  });

  it('refuses a number that is not an Indian mobile without calling the provider', async () => {
    const { provider, sent } = recorder();
    await expect(sendSms(provider, '12345', 'Hi')).rejects.toBeInstanceOf(InvalidPhoneNumberError);
    expect(sent).toHaveLength(0);
  });

  it('fails clearly when SMS is not configured', async () => {
    await expect(
      sendSms(createUnconfiguredSmsProvider(), '9822012345', 'Hi'),
    ).rejects.toBeInstanceOf(SmsNotConfiguredError);
  });
});
