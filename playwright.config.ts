import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// End-to-end tests run the real API and the real client against the separate test
// database, on their own ports, so they never touch development data.
const serverEnv = loadEnv({ path: 'server/.env', quiet: true }).parsed ?? {};
const testDatabaseUrl = serverEnv.DATABASE_URL_TEST;
if (!testDatabaseUrl) {
  throw new Error('DATABASE_URL_TEST must be set in server/.env to run the end-to-end tests.');
}

const API_PORT = 4100;
const CLIENT_PORT = 5174;
export const E2E_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
    timezoneId: 'Europe/London', // a non-IST zone, to prove dates still show in IST
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: 'server',
      port: API_PORT,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: testDatabaseUrl,
        CLIENT_URL: `http://localhost:${CLIENT_PORT}`,
        NODE_ENV: 'test',
        ENABLE_SCHEDULER: 'false',
        // The suite signs up a fresh account per test, all from this machine.
        SIGNUP_LIMIT_PER_HOUR: '1000',
        // Never deliver real email or SMS from automated tests, whatever server/.env
        // contains: empty values count as "not configured", so sends fail cleanly.
        SMTP_HOST: '',
        SMTP_USER: '',
        SMTP_PASS: '',
        TWILIO_ACCOUNT_SID: '',
        TWILIO_AUTH_TOKEN: '',
        TWILIO_FROM_NUMBER: '',
      },
    },
    {
      command: `npx vite --port ${CLIENT_PORT} --strictPort`,
      cwd: 'client',
      port: CLIENT_PORT,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
