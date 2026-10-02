import { expect, test } from '@playwright/test';
import { PASSWORD, signUpViaApi, uniqueEmail } from './helpers';

test('sign up, log out, fail and succeed at logging in', async ({ page }) => {
  const email = uniqueEmail();

  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole('link', { name: 'Create an account' }).click();

  // Client-side validation shows the same messages as the server.
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter your name')).toBeVisible();

  await page.getByLabel('Full name').fill('Priya Sharma');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile number').fill('12345');
  await page.getByLabel('Bar Council enrolment number').fill('MAH/2041/2012');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a valid Indian mobile number')).toBeVisible();
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  await expect(page.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Mobile number').fill('98220 12345');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { level: 1, name: /, Priya Sharma$/ })).toBeVisible();
  await expect(page.getByText('Priya Sharma').first()).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('wrongpass999');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /, Priya Sharma$/ })).toBeVisible();
});

test('a duplicate email is reported on the signup form', async ({ page }) => {
  const { email } = await signUpViaApi(page);
  await page.context().clearCookies();

  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Someone Else');
  await page.getByLabel('Email').fill(email.toUpperCase());
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByLabel('Bar Council enrolment number').fill('DEL/1/2020');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('alert')).toContainText('An account with this email already exists');
});

test('after logging in, the lawyer returns to the page they asked for', async ({ page }) => {
  const { email } = await signUpViaApi(page);
  await page.context().clearCookies();

  await page.goto('/clients/new');
  await expect(page).toHaveURL(/\/login\?next=%2Fclients%2Fnew/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/clients\/new$/);
  await expect(page.getByRole('heading', { name: 'Add a client' })).toBeVisible();
});

test('forgot password gives the same answer for any email', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill('nobody-here@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText(
    'If an account exists for that email, we have sent a link',
  );
});

test('a reset link without its token explains what to do', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByRole('alert')).toContainText('This link is missing its code');
});
