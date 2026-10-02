import { execSync } from 'node:child_process';
import 'dotenv/config';

// Bring the test database up to the latest migration before any test runs.
export default function setup() {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error('DATABASE_URL_TEST must be set in server/.env to run the tests.');
  }
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
