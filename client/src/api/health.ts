import { z } from 'zod';

export const healthResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), database: z.literal('ok') }),
  z.object({ status: z.literal('error'), database: z.literal('error'), message: z.string() }),
]);

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export async function fetchHealth(): Promise<HealthResponse> {
  let res: Response;
  try {
    res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('Could not reach the CaseMate server. Is it running?');
  }

  const body: unknown = await res.json().catch(() => null);
  const parsed = healthResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`The server answered with an unexpected response (HTTP ${res.status}).`);
  }
  return parsed.data;
}
