import { PrismaClient } from '@prisma/client';

// One shared client for the whole server. `tsx watch` re-imports modules on every
// change, so in development the instance is kept on globalThis to avoid opening a
// new connection pool each reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
