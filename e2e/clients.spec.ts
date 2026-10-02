import { expect, test } from '@playwright/test';
import { signUpViaApi } from './helpers';

test('add, view, note, edit, search and delete a client', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/clients');

  await expect(page.getByRole('heading', { name: 'No clients yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Add your first client' }).click();

  await page.getByLabel('Name').fill('Ramesh Gupta');
  await page.getByLabel('Mobile number').fill('98220 11223');
  await page.getByLabel('Preferred contact').selectOption('EMAIL');
  await page.getByLabel('Hourly rate (₹)').fill('2,500');
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByText('Add an email address, or choose another way')).toBeVisible();

  await page.getByLabel('Email').fill('ramesh@example.com');
  await page.getByLabel('Languages').fill('Marathi, Hindi');
  await page.getByLabel('Address').fill('12 FC Road, Pune');
  await page.getByRole('button', { name: 'Add client' }).click();

  await expect(page.getByRole('heading', { name: 'Ramesh Gupta' })).toBeVisible();
  await expect(page.getByText('+919822011223')).toBeVisible();
  await expect(page.getByText('₹2,500', { exact: true })).toBeVisible();
  await expect(page.getByText('No cases for this client yet.')).toBeVisible();
  await expect(page.getByText('₹0').first()).toBeVisible();

  await page.getByLabel('Add a note from a call or meeting').fill('Asked about the sale agreement');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Asked about the sale agreement')).toBeVisible();

  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Name').fill('Ramesh K. Gupta');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Ramesh K. Gupta' })).toBeVisible();

  // The list updates and can be searched.
  const list = page.getByRole('list').filter({ hasText: 'Ramesh K. Gupta' });
  await expect(list).toBeVisible();
  await page.getByLabel('Search clients').fill('nobody');
  await expect(page.getByText('No clients match “nobody”.')).toBeVisible();
  await page.getByLabel('Search clients').fill('ramesh');
  await expect(list).toBeVisible();
  await page.getByLabel('Search clients').fill('');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No clients yet' })).toBeVisible();
});

test("one lawyer cannot open another lawyer's client", async ({ browser }) => {
  const owner = await browser.newPage();
  await signUpViaApi(owner, 'Owner Advocate');
  const created = await owner.request.post('/api/clients', {
    data: { name: 'Private Client', phone: '9876543210', preferredContact: 'PHONE' },
  });
  const { client } = await created.json();

  const other = await browser.newPage();
  await signUpViaApi(other, 'Other Advocate');
  await other.goto(`/clients/${client.id}`);
  await expect(other.getByRole('alert')).toContainText('This client does not exist');
  await expect(other.getByText('Private Client')).toHaveCount(0);
});

test('@mobile the sidebar folds into a menu button', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile layout only');
  await signUpViaApi(page);
  await page.goto('/clients');

  const menu = page.getByRole('button', { name: 'Open menu' });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await menu.click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
});
