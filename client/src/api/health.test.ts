import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('accepts the healthy response shape', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok', database: 'ok' }).success).toBe(true);
  });

  it('requires a message when the database is down', () => {
    expect(healthResponseSchema.safeParse({ status: 'error', database: 'error' }).success).toBe(
      false,
    );
  });

  it('rejects a mixed status', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok', database: 'error' }).success).toBe(false);
  });
});
