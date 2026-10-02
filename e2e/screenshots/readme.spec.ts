import { expect, test, type Page } from '@playwright/test';
import { istDay } from '../db';

// Builds a small, realistic practice through the UI (sign-up, clients, cases, a hearing
// outcome, time and an invoice) in the test database, and photographs each main screen
// for the README.
const SHOTS = 'docs/screenshots';

const istTimeNow = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });

async function shot(page: Page, name: string) {
  // Let fonts and late queries settle so the picture is stable.
  await page.waitForLoadState('networkidle');
  // Make the window as tall as the page, so the fixed sidebar is drawn correctly (a
  // full-page capture of a shorter window is not).
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height: Math.max(860, height) });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.setViewportSize({ width: 1280, height: 860 });
}

async function addClient(
  page: Page,
  client: { name: string; phone: string; email: string; address: string; rate: string },
) {
  await nav(page, 'Clients').click();
  await page
    .getByRole('link', { name: /Add (a |your first )?client/ })
    .first()
    .click();
  await page.getByLabel('Name').fill(client.name);
  await page.getByLabel('Mobile number').fill(client.phone);
  await page.getByLabel('Email').fill(client.email);
  await page.getByLabel('Address').fill(client.address);
  await page.getByLabel('Hourly rate (₹)').fill(client.rate);
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByRole('heading', { name: client.name })).toBeVisible();
}

async function fillCase(
  page: Page,
  c: {
    client: string;
    title: string;
    number: string;
    court: string;
    room: string;
    judge?: string;
    opposing?: string;
    date: string;
    time: string;
    purpose: string;
    note?: string;
  },
) {
  await page.getByLabel('Client').selectOption({ label: c.client });
  await page.getByLabel('Title').fill(c.title);
  await page.getByLabel('Case number').fill(c.number);
  await page.getByRole('textbox', { name: 'Court', exact: true }).fill(c.court);
  await page.getByLabel('Courtroom').fill(c.room);
  if (c.judge) await page.getByLabel('Judge').fill(c.judge);
  if (c.opposing) await page.getByLabel('Opposing party').fill(c.opposing);
  await page.getByLabel('Date').fill(c.date);
  await page.getByLabel('Time (IST)').fill(c.time);
  await page.getByLabel('Purpose').fill(c.purpose);
  if (c.note) await page.getByLabel('Note for this hearing').fill(c.note);
}

test('README screenshots', async ({ page }) => {
  test.skip(istTimeNow() >= '22:30', 'needs a few hours left in the IST day');

  // Sign up.
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Adv. Priya Sharma');
  await page.getByLabel('Email').fill(`priya.sharma.${Date.now()}@example.com`);
  await page.getByLabel('Mobile number').fill('98220 12345');
  await page.getByLabel('Bar Council enrolment number').fill('MAH/2041/2012');
  await page.getByLabel('Password').fill('casemate2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Priya Sharma/ })).toBeVisible();

  await addClient(page, {
    name: 'Ramesh Gupta',
    phone: '98220 11223',
    email: 'ramesh.gupta@example.com',
    address: '12, Shanti Nagar, Kothrud\nPune 411038',
    rate: '3000',
  });
  await addClient(page, {
    name: 'Sunita Patil',
    phone: '99001 12233',
    email: 'sunita.patil@example.com',
    address: '4, Model Colony, Shivajinagar\nPune 411016',
    rate: '2500',
  });

  // A case heard today (its outcome is logged below) and two coming up.
  const gupta = {
    client: 'Ramesh Gupta',
    title: 'Gupta vs. Mehta Builders',
    number: 'RCS/412/2026',
    court: 'Civil Court (Senior Division), Pune',
    room: 'Room 4',
    judge: 'Hon. A. R. Deshpande',
    opposing: 'Mehta Builders Pvt. Ltd.',
    date: istDay(0),
    time: '23:00',
    purpose: 'Evidence',
    note: 'Bring the original sale agreement',
  };
  await nav(page, 'Cases').click();
  await page
    .getByRole('link', { name: /Add (your first )?case/ })
    .first()
    .click();
  await fillCase(page, gupta);
  await shot(page, 'add-case');
  await page.getByRole('button', { name: 'Save case' }).click();
  await expect(page.getByRole('heading', { name: gupta.title })).toBeVisible();
  const guptaUrl = page.url();

  for (const c of [
    {
      client: 'Sunita Patil',
      title: 'Patil vs. State of Maharashtra',
      number: 'WP/1187/2026',
      court: 'Bombay High Court',
      room: 'Court 21',
      date: istDay(0),
      time: '23:30',
      purpose: 'Admission',
    },
    {
      client: 'Sunita Patil',
      title: 'Patil vs. Kulkarni',
      number: 'RCA/96/2026',
      court: 'District Court, Pune',
      room: 'Room 11',
      date: istDay(3),
      time: '11:00',
      purpose: 'Arguments',
    },
    {
      client: 'Ramesh Gupta',
      title: 'Gupta vs. Pune Municipal Corporation',
      number: 'WP/2210/2026',
      court: 'Bombay High Court',
      room: 'Court 7',
      date: istDay(5),
      time: '10:30',
      purpose: 'Reply',
    },
  ]) {
    await nav(page, 'Cases').click();
    await page
      .getByRole('link', { name: /Add (your first )?case/ })
      .first()
      .click();
    await fillCase(page, c);
    await page.getByRole('button', { name: 'Save case' }).click();
    await expect(page.getByRole('heading', { name: c.title })).toBeVisible();
  }

  // Log today's outcome on the Gupta case: adjourned, 1 h 30 min, next date in two weeks.
  await page.goto(guptaUrl);
  const outcome = page.getByRole('region', { name: /Log the outcome of/ });
  await outcome.getByLabel('What happened').selectOption('ADJOURNED');
  await outcome.getByLabel('Notes').fill('Defendant sought time to file additional documents.');
  await outcome.getByLabel('Hours').fill('1');
  await outcome.getByLabel('Minutes').fill('30');
  await outcome.getByRole('textbox', { name: 'Next date', exact: true }).fill(istDay(14));
  await outcome.getByLabel('Time (IST)').fill('11:00');
  await outcome.getByLabel('Purpose').fill('Evidence (continued)');
  await outcome.getByRole('button', { name: 'Save outcome' }).click();
  await expect(page.getByRole('region', { name: 'Next hearing' })).toBeVisible();
  await expect(page.getByText('Adjourned')).toBeVisible();
  await shot(page, 'case-page');

  // Billing: log more time, invoice the Gupta time, mark it sent.
  await nav(page, 'Billing').click();
  const logTime = async (caseLabel: RegExp, hours: string, work: string) => {
    await page.getByRole('button', { name: '+ Log time' }).click();
    const dialog = page.getByRole('dialog', { name: 'Log time' });
    const select = dialog.getByLabel('Case');
    const option = select.locator('option').filter({ hasText: caseLabel });
    await select.selectOption({ label: (await option.textContent())! });
    await dialog.getByLabel('Hours').fill(hours);
    await dialog.getByLabel('Work done').fill(work);
    await dialog.getByRole('button', { name: 'Log time' }).click();
    await expect(dialog).toBeHidden();
  };
  await logTime(/Gupta vs\. Mehta Builders/, '2', 'Drafting the written statement');
  await logTime(/Patil vs\. Kulkarni/, '3', 'Preparing written arguments');
  await logTime(/Gupta vs\. Pune Municipal/, '1', 'Conference with client on the petition');

  await page.getByRole('button', { name: '+ Create invoice' }).click();
  await page.getByRole('combobox', { name: 'Client' }).selectOption({ label: 'Ramesh Gupta' });
  // Bill the Mehta Builders work; keep the newer petition conference unbilled.
  await page.getByRole('checkbox', { name: /Conference with client/ }).uncheck();
  await page.getByLabel('Notes on the invoice').fill('Payable by bank transfer within 15 days.');
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page.getByText('Invoice INV-001 created as a draft.')).toBeVisible();
  await page.getByRole('button', { name: 'Mark as sent INV-001' }).click();
  await expect(
    page.getByRole('region', { name: 'Invoices' }).getByText('Sent', { exact: true }),
  ).toBeVisible();
  await page.goto('/billing');
  await shot(page, 'billing');

  // Client profile, dashboard and settings.
  await nav(page, 'Clients').click();
  await page
    .getByRole('link', { name: /Ramesh Gupta/ })
    .first()
    .click();
  await expect(page.getByRole('region', { name: 'Billing' })).toBeVisible();
  await shot(page, 'client-profile');

  await nav(page, 'Dashboard').click();
  await expect(page.getByRole('group', { name: 'Unpaid invoices' })).toContainText('₹');
  await shot(page, 'dashboard');

  await nav(page, 'Settings').click();
  await page.getByLabel('Default hourly rate (₹)').fill('2000');
  await page.getByRole('button', { name: 'Save billing settings' }).click();
  await expect(page.getByText(/Default rate saved/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'SMS' })).toBeVisible();
  await shot(page, 'settings');
});
