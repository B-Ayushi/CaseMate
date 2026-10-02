import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// `npm run screenshots`: the README screenshots in docs/screenshots. Same servers and
// separate test database as the end-to-end tests (emptied first by the global setup);
// every record in the pictures is created through the UI during the run.
export default defineConfig({
  ...base,
  testDir: 'e2e/screenshots',
  testIgnore: [],
  timeout: 120_000,
  projects: [
    {
      name: 'screenshots',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 860 },
        timezoneId: 'Asia/Kolkata',
        locale: 'en-IN',
      },
    },
  ],
});
