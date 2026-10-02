import 'dotenv/config';

// Tests always run against the separate test database, never the development one.
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error('DATABASE_URL_TEST must be set in server/.env to run the tests.');
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_TEST must point to a different database than DATABASE_URL.');
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
