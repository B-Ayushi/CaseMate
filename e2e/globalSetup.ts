import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { E2E_DATABASE_URL } from '../playwright.config';

// Bring the test database up to date and empty it before the run.
export default async function globalSetup() {
  execSync('npx prisma migrate deploy', {
    cwd: 'server',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
  try {
    await prisma.timeEntry.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.reminder.deleteMany();
    await prisma.hearing.deleteMany();
    await prisma.case.deleteMany();
    await prisma.clientNote.deleteMany();
    await prisma.client.deleteMany();
    await prisma.lawyer.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
}
