import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { istDay } from './db';
import { signUpViaApi } from './helpers';

// A client at ₹3,000 an hour, with an email address, and one case.
async function clientWithCase(page: Page) {
  const client = await page.request.post('/api/clients', {
    data: {
      name: 'Ramesh Gupta',
      phone: '9822011223',
      email: 'ramesh@example.com',
      hourlyRatePaise: 300000,
    },
  });
  expect(client.status()).toBe(201);
  const clientId = (await client.json()).client.id as string;
  const legalCase = await page.request.post('/api/cases', {
    data: {
      clientId,
      title: 'Gupta vs. Mehta Builders',
      caseNumber: 'RCS/412/2026',
      courtName: 'Civil Court, Pune',
      firstHearing: { date: istDay(10), time: '10:30' },
    },
  });
  expect(legalCase.status()).toBe(201);
  return { clientId, caseId: (await legalCase.json()).case.id as string };
}

const stat = (page: Page, label: string) => page.getByRole('group', { name: label, exact: true });
const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });

test('log time, invoice it, download the PDF, mark it sent and paid', async ({ page }) => {
  // A long journey through several pages; allow it more than the default 30 seconds.
  test.setTimeout(60_000);
  await signUpViaApi(page);
  const { clientId, caseId } = await clientWithCase(page);
  // Some earlier time, logged through the API.
  const earlier = await page.request.post('/api/time-entries', {
    data: { caseId, workDate: istDay(0), minutes: 30, description: 'Call with client' },
  });
  expect(earlier.status()).toBe(201);

  await page.goto('/');
  await nav(page, 'Billing').click();
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  await expect(page.getByText('No invoices yet.', { exact: false })).toBeVisible();

  // Log time: the rate and amount are shown before saving.
  await page.getByRole('button', { name: '+ Log time' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log time' });
  await dialog
    .getByLabel('Case')
    .selectOption({ label: 'Gupta vs. Mehta Builders (RCS/412/2026) · Ramesh Gupta' });
  await dialog.getByLabel('Hours').fill('1');
  await dialog.getByLabel('Minutes').fill('30');
  await dialog.getByLabel('Work done').fill('Drafting the written statement');
  await expect(dialog.getByText('₹3,000 an hour')).toBeVisible();
  await expect(dialog.getByText("(Ramesh Gupta's rate)")).toBeVisible();
  await expect(dialog.getByText('₹4,500')).toBeVisible();
  await dialog.getByRole('button', { name: 'Log time' }).click();
  await expect(dialog).toBeHidden();

  const unbilled = page.getByRole('region', { name: 'Unbilled time' });
  await expect(unbilled.getByText('Drafting the written statement')).toBeVisible();
  await expect(unbilled.getByText('Call with client')).toBeVisible();
  await expect(stat(page, 'Unbilled time')).toContainText('₹6,000');

  // Create the invoice: pick the client, their entries are ticked, check total and due date.
  await page.getByRole('button', { name: '+ Create invoice' }).click();
  await page.getByRole('combobox', { name: 'Client' }).selectOption({ label: 'Ramesh Gupta' });
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await expect(page.getByLabel('Due date')).toHaveValue(istDay(15));
  await expect(page.getByText('2 entries · Total')).toContainText('₹6,000');
  await page.getByRole('button', { name: 'Create invoice' }).click();

  await expect(page.getByText('Invoice INV-001 created as a draft.')).toBeVisible();
  const invoices = page.getByRole('region', { name: 'Invoices' });
  const row = invoices.getByRole('row', { name: /INV-001/ });
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();
  await expect(row.getByText('₹6,000')).toBeVisible();
  await expect(unbilled.getByText(/No unbilled time/)).toBeVisible();

  // The PDF downloads and is a real PDF.
  const downloadPromise = page.waitForEvent('download');
  await invoices.getByRole('button', { name: 'Download PDF INV-001' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('INV-001.pdf');
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.subarray(-8).toString()).toContain('%%EOF');
  expect(pdf.length).toBeGreaterThan(5000);

  // Shared another way, then paid. ("Send by email" is never clicked in tests.)
  await invoices.getByRole('button', { name: 'Mark as sent INV-001' }).click();
  await expect(row.getByText('Sent', { exact: true })).toBeVisible();
  await expect(stat(page, 'Billed')).toContainText('₹6,000');
  await expect(stat(page, 'Outstanding')).toContainText('₹6,000');
  await expect(stat(page, 'Received')).toContainText('₹0');

  await nav(page, 'Dashboard').click();
  await expect(stat(page, 'Unpaid invoices')).toContainText('₹6,000');
  await expect(stat(page, 'Unpaid invoices')).toContainText('1 sent invoice not yet paid');

  await page.goto(`/clients/${clientId}`);
  const clientBilling = page.getByRole('region', { name: 'Billing' });
  await expect(clientBilling).toContainText(/Billed\s*₹6,000/);
  await expect(clientBilling).toContainText(/Paid\s*₹0/);
  await expect(clientBilling).toContainText(/Due\s*₹6,000/);

  await nav(page, 'Billing').click();
  await page
    .getByRole('region', { name: 'Invoices' })
    .getByRole('button', { name: 'Mark paid INV-001' })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Invoices' })
      .getByRole('row', { name: /INV-001/ })
      .getByText('Paid', { exact: true }),
  ).toBeVisible();
  await expect(stat(page, 'Received')).toContainText('₹6,000');
  await expect(stat(page, 'Outstanding')).toContainText('₹0');
  // A paid invoice offers only the download.
  await expect(page.getByRole('button', { name: 'Mark paid INV-001' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete draft INV-001' })).toHaveCount(0);

  await nav(page, 'Dashboard').click();
  await expect(stat(page, 'Unpaid invoices')).toContainText('₹0');

  await page.goto(`/clients/${clientId}`);
  await expect(page.getByRole('region', { name: 'Billing' })).toContainText(/Paid\s*₹6,000/);
  await expect(page.getByRole('region', { name: 'Billing' })).toContainText(/Due\s*₹0/);

  // The case's billing tab shows each entry on the paid invoice.
  await page.goto(`/cases/${caseId}?tab=time`);
  const timeTab = page.getByRole('tabpanel', { name: 'Time and billing' });
  await expect(timeTab.getByRole('link', { name: 'INV-001' })).toHaveCount(2);
  await expect(timeTab.getByText('Paid', { exact: true })).toHaveCount(2);
  await expect(timeTab.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
});

test('the default rate in Settings applies to new time only', async ({ page }) => {
  await signUpViaApi(page);
  const client = await page.request.post('/api/clients', {
    data: { name: 'Sunita Patil', phone: '9900112233' },
  });
  const legalCase = await page.request.post('/api/cases', {
    data: {
      clientId: (await client.json()).client.id,
      title: 'Patil vs. State',
      caseNumber: 'WP/9/2026',
      courtName: 'High Court, Mumbai',
      firstHearing: { date: istDay(10), time: '11:00' },
    },
  });
  const caseId = (await legalCase.json()).case.id as string;

  await page.goto('/settings');
  const billing = page.getByRole('region', { name: 'Billing' });
  await billing.getByLabel('Default hourly rate (₹)').fill('2,500');
  await billing.getByRole('button', { name: 'Save billing settings' }).click();
  await expect(billing.getByText(/Default rate saved/)).toBeVisible();

  const first = await page.request.post('/api/time-entries', {
    data: { caseId, workDate: istDay(0), minutes: 60, description: 'Research' },
  });
  expect((await first.json()).timeEntry).toMatchObject({ ratePaise: 250000, amountPaise: 250000 });

  await billing.getByLabel('Default hourly rate (₹)').fill('4000');
  await billing.getByRole('button', { name: 'Save billing settings' }).click();
  await expect(billing.getByText(/Default rate saved/)).toBeVisible();

  await page.goto(`/cases/${caseId}?tab=time`);
  const timeTab = page.getByRole('tabpanel', { name: 'Time and billing' });
  await expect(timeTab.getByText('At ₹2,500 an hour')).toBeVisible();
  // Logging new time shows the new default before saving.
  await timeTab.getByRole('button', { name: '+ Log time' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log time' });
  await dialog.getByLabel('Hours').fill('2');
  await expect(dialog.getByText('₹4,000 an hour')).toBeVisible();
  await expect(dialog.getByText('(your default rate)')).toBeVisible();
  await expect(dialog.getByText('₹8,000')).toBeVisible();
});

test('@mobile billing tables become cards on a small screen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile layout only');
  await signUpViaApi(page);
  const { clientId, caseId } = await clientWithCase(page);
  const entry = await page.request.post('/api/time-entries', {
    data: { caseId, workDate: istDay(0), minutes: 60, description: 'Drafting' },
  });
  const other = await page.request.post('/api/time-entries', {
    data: { caseId, workDate: istDay(0), minutes: 15, description: 'Call' },
  });
  const invoice = await page.request.post('/api/invoices', {
    data: { clientId, timeEntryIds: [(await entry.json()).timeEntry.id] },
  });
  expect(invoice.status()).toBe(201);
  expect(other.status()).toBe(201);

  await page.goto('/billing');
  await expect(page.getByRole('table')).toHaveCount(0);
  const invoices = page.getByRole('region', { name: 'Invoices' });
  await expect(invoices.getByRole('listitem').first()).toContainText('INV-001');
  await expect(invoices.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Unbilled time' }).getByText('Call')).toBeVisible();
});
