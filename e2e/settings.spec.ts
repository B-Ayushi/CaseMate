import { expect, test, type Page } from '@playwright/test';
import { db, istDay } from './db';
import { PASSWORD, signUpViaApi } from './helpers';

async function caseWithHearing(page: Page) {
  const client = await page.request.post('/api/clients', {
    data: { name: 'Ramesh Gupta', phone: '9822011223' },
  });
  const res = await page.request.post('/api/cases', {
    data: {
      clientId: (await client.json()).client.id,
      title: 'Gupta vs. Mehta Builders',
      caseNumber: 'RCS/412/2026',
      courtName: 'Civil Court, Pune',
      firstHearing: { date: istDay(10), time: '10:30' },
    },
  });
  expect(res.status()).toBe(201);
}

async function openSettings(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
}

test('change a reminder preference and see the confirmation', async ({ page }) => {
  const { email } = await signUpViaApi(page);
  await caseWithHearing(page);
  await openSettings(page);

  const reminders = page.getByRole('region', { name: 'Reminders' });
  const sms = reminders.getByRole('switch', { name: 'SMS' });
  await expect(sms).toBeChecked();
  await expect(reminders.getByText('2 hours before each hearing')).toBeVisible();

  await sms.uncheck();
  // The 2-hour reminder only goes by SMS, so the page says it will not be sent.
  await expect(
    reminders.getByText('SMS is off above, so this reminder is not sent.'),
  ).toBeVisible();

  // The time picker is shown only while the daily summary is on.
  await expect(reminders.getByLabel('Daily summary time (IST)')).toBeVisible();
  await reminders.getByRole('switch', { name: 'Daily summary' }).uncheck();
  await expect(reminders.getByLabel('Daily summary time (IST)')).toHaveCount(0);
  await reminders.getByRole('switch', { name: 'Daily summary' }).check();
  await reminders.getByLabel('Daily summary time (IST)').selectOption('06:45');
  await expect(
    reminders.getByText('Every morning with today’s hearings, at 6:45 AM'),
  ).toBeVisible();

  await reminders.getByRole('button', { name: 'Save reminder settings' }).click();
  await expect(reminders.getByText('Updated reminders for 1 upcoming hearing.')).toBeVisible();

  const lawyer = await db.lawyer.findUniqueOrThrow({ where: { email } });
  expect(lawyer).toMatchObject({ smsEnabled: false, dailySummaryTime: '06:45' });
  const smsReminders = await db.reminder.findMany({
    where: { lawyerId: lawyer.id, channel: 'SMS' },
  });
  expect(smsReminders.length).toBeGreaterThan(0);
  expect(smsReminders.every((r) => r.status === 'CANCELLED')).toBe(true);

  // The saved settings are what the page shows after a reload.
  await page.reload();
  await expect(page.getByRole('switch', { name: 'SMS' })).not.toBeChecked();
  await expect(page.getByLabel('Daily summary time (IST)')).toHaveValue('06:45');
});

test('change the profile phone', async ({ page }) => {
  const { email } = await signUpViaApi(page);
  await openSettings(page);

  const profile = page.getByRole('region', { name: 'Profile' });
  await expect(profile.getByLabel('Email')).toHaveValue(email);
  await expect(profile.getByLabel('Email')).toHaveAttribute('readonly', '');

  await profile.getByLabel('Mobile number').fill('12345');
  await profile.getByRole('button', { name: 'Save profile' }).click();
  await expect(profile.getByText('Enter a valid Indian mobile number')).toBeVisible();

  await profile.getByLabel('Mobile number').fill('098220 99999');
  await profile.getByRole('button', { name: 'Save profile' }).click();
  await expect(profile.getByText('Profile saved.')).toBeVisible();
  // Stored, and shown, in the +91 form SMS reminders use.
  await expect(profile.getByLabel('Mobile number')).toHaveValue('+919822099999');
  expect((await db.lawyer.findUniqueOrThrow({ where: { email } })).phone).toBe('+919822099999');
});

test('change the password and log in with the new one', async ({ page }) => {
  const { email } = await signUpViaApi(page);
  await openSettings(page);

  const password = page.getByRole('region', { name: 'Change password' });
  await password.getByLabel('Current password').fill('notmypassword1');
  await password.getByLabel(/^New password/).fill('fresh-pass-2026');
  await password.getByLabel('Confirm new password').fill('fresh-pass-2026');
  await password.getByRole('button', { name: 'Change password' }).click();
  await expect(password.getByText('This is not your current password')).toBeVisible();

  await password.getByLabel('Current password').fill(PASSWORD);
  await password.getByRole('button', { name: 'Change password' }).click();
  await expect(password.getByText(/Your password has been changed/)).toBeVisible();

  // Still logged in here: other pages keep working.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Clients' })
    .click();
  await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');

  await page.getByLabel('Password').fill('fresh-pass-2026');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /, Priya Sharma$/ })).toBeVisible();
});

test('delete the account after confirming in a dialog', async ({ page }) => {
  const { email } = await signUpViaApi(page);
  await caseWithHearing(page);
  await openSettings(page);

  const data = page.getByRole('region', { name: 'Your data' });
  await data.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('This can’t be undone.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  await data.getByRole('button', { name: 'Delete my account' }).click();
  await dialog.getByLabel(/Type your email/).fill('someone-else@example.com');
  await dialog.getByLabel('Your password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Delete my account permanently' }).click();
  await expect(dialog.getByText('Type the email address you log in with')).toBeVisible();
  expect(await db.lawyer.count({ where: { email } })).toBe(1);

  await dialog.getByLabel(/Type your email/).fill(email);
  await dialog.getByRole('button', { name: 'Delete my account permanently' }).click();
  await expect(page.getByText('Your account and all its data have been deleted.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await db.lawyer.count({ where: { email } })).toBe(0);
});
