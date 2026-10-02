import { Prisma, type PrismaClient } from '@prisma/client';

export type HealthResult =
  | { ok: true; body: { status: 'ok'; database: 'ok' } }
  | { ok: false; body: { status: 'error'; database: 'error'; message: string } };

function describeDatabaseError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return `Cannot connect to the database: ${error.message.trim().split('\n').pop()}`;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `Database query failed (${error.code}).`;
  }
  return 'Database query failed.';
}

export async function checkHealth(prisma: PrismaClient): Promise<HealthResult> {
  try {
    // MySQL returns integer literals as BigInt, so compare numerically.
    const rows = await prisma.$queryRaw<{ ok: number | bigint }[]>`SELECT 1 AS ok`;
    if (Number(rows[0]?.ok) !== 1) {
      return {
        ok: false,
        body: {
          status: 'error',
          database: 'error',
          message: 'Database returned an unexpected result.',
        },
      };
    }
    return { ok: true, body: { status: 'ok', database: 'ok' } };
  } catch (error) {
    return {
      ok: false,
      body: { status: 'error', database: 'error', message: describeDatabaseError(error) },
    };
  }
}
