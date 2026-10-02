import { expect, test, type Page } from '@playwright/test';
import { dayLabel, db, istDay } from './db';
import { signUpViaApi } from './helpers';

async function createClient(page: Page, name = 'Ramesh Gupta') {
  const res = await page.request.post('/api/clients', {
    data: { name, phone: '9822011223' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).client as { id: string };
}

// The current time of day in IST, "HH:mm".
const istTimeNow = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());

const stat = (page: Page, label: string) => page.getByRole('group', { name: label });

test('a new account sees a friendly empty state in every panel', async ({ page }) => {
  await signUpViaApi(page, 'Priya Sharma');
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: /, Priya Sharma$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '+ Add new case' })).toBeVisible();
  await expect(stat(page, 'Hearings today')).toContainText('0');
  await expect(stat(page, 'Next 7 days')).toContainText('0');
  await expect(stat(page, 'Need next date')).toContainText('0');

  const today = page.getByRole('region', { name: 'Today’s hearings' });
  await expect(today.getByText('No cases yet')).toBeVisible();
  await expect(today.getByRole('link', { name: 'Add your first case' })).toBeVisible();
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention.getByText('All clear')).toBeVisible();
  const comingUp = page.getByRole('region', { name: 'Coming up in the next 7 days' });
  await expect(comingUp.getByText(/Once you add cases/)).toBeVisible();
  await expect(comingUp.getByRole('listitem')).toHaveCount(7);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Calendar' })
    .click();
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  await expect(page.getByText('No hearings on this day.')).toBeVisible();
});

test('a case for today shows on the dashboard and the calendar', async ({ page }) => {
  test.skip(istTimeNow() >= '23:40', 'needs a few minutes left in the IST day');
  await signUpViaApi(page);
  await createClient(page);
  await page.goto('/');

  // Add the case through the form, with its hearing late tonight (IST).
  await page.getByRole('link', { name: '+ Add new case' }).click();
  await page.getByLabel('Client').selectOption({ label: 'Ramesh Gupta' });
  await page.getByLabel('Title').fill('Gupta vs. Mehta Builders');
  await page.getByLabel('Case number').fill('RCS/412/2026');
  await page.getByRole('textbox', { name: 'Court', exact: true }).fill('Civil Court, Pune');
  await page.getByLabel('Courtroom').fill('Room 4');
  await page.getByLabel('Date').fill(istDay(0));
  await page.getByLabel('Time (IST)').fill('23:45');
  await page.getByRole('button', { name: 'Save case' }).click();
  await expect(page.getByRole('heading', { name: 'Gupta vs. Mehta Builders' })).toBeVisible();

  // Dashboard: counted and listed today (this browser runs on London time).
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Dashboard' })
    .click();
  await expect(stat(page, 'Hearings today')).toContainText('1');
  await expect(stat(page, 'Next 7 days')).toContainText('0');
  await expect(stat(page, 'Need next date')).toContainText('0');
  const today = page.getByRole('region', { name: 'Today’s hearings' });
  await expect(today.getByText('11:45 PM')).toBeVisible();
  await expect(today.getByText('RCS/412/2026 · Civil Court, Pune, Room 4')).toBeVisible();
  await expect(today.getByText('Client: Ramesh Gupta')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Needs attention' }).getByText('All clear'),
  ).toBeVisible();

  // Each row opens its case.
  await today.getByRole('link', { name: /Gupta vs\. Mehta Builders/ }).click();
  await expect(page).toHaveURL(/\/cases\/c[a-z0-9]+$/);
  await page.goBack();

  // Calendar: today is highlighted and shows the hearing; the day's list links to the case.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Calendar' })
    .click();
  const todayCell = page.getByRole('button', { name: /, today: 1 hearing$/ });
  await expect(todayCell).toBeVisible();
  await expect(todayCell).toHaveAttribute('aria-current', 'date');
  const dayPanel = page.getByRole('region', { name: /^Hearings on / });
  await expect(dayPanel.getByText('11:45 PM')).toBeVisible();
  await dayPanel.getByRole('link', { name: /Gupta vs\. Mehta Builders/ }).click();
  await expect(page.getByRole('heading', { name: 'Gupta vs. Mehta Builders' })).toBeVisible();
});

test('needs attention: add a next date, and retry a failed reminder', async ({ page }) => {
  await signUpViaApi(page);
  const client = await createClient(page);
  const post = (title: string, caseNumber: string, date: string) =>
    page.request
      .post('/api/cases', {
        data: {
          clientId: client.id,
          title,
          caseNumber,
          courtName: 'Civil Court, Pune',
          firstHearing: { date, time: '10:30' },
        },
      })
      .then(async (r) => (await r.json()).case.id as string);
  const pastCase = await post('Gupta vs. Mehta Builders', 'RCS/412/2026', istDay(5));
  const futureCase = await post('State vs. Kulkarni', 'BA/77/2026', istDay(6));

  // One hearing took place yesterday with no outcome, and one reminder failed to send
  // (both only possible to set up in the database).
  await db.hearing.updateMany({
    where: { caseId: pastCase },
    data: { scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
  const failed = await db.reminder.findFirstOrThrow({
    where: { hearing: { caseId: futureCase }, type: 'DAY_BEFORE', channel: 'EMAIL' },
  });
  await db.reminder.update({
    where: { id: failed.id },
    data: {
      status: 'FAILED',
      attempts: 4,
      lastError: 'self-signed certificate in certificate chain',
    },
  });

  await page.goto('/');
  await expect(stat(page, 'Need next date')).toContainText('1');
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(
    attention.getByText('Email could not be sent: the secure connection to the mail server failed'),
  ).toBeVisible();

  await attention
    .getByRole('button', { name: /^Retry Day before Email for State vs\. Kulkarni$/ })
    .click();
  await expect(attention.getByText(/Email could not be sent/)).toHaveCount(0);
  await expect
    .poll(async () => (await db.reminder.findUniqueOrThrow({ where: { id: failed.id } })).status)
    .toBe('PENDING');

  // "Add next date" opens the case at its log-outcome card, ready to fill in.
  await attention.getByRole('link', { name: 'Add next date for Gupta vs. Mehta Builders' }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${pastCase}#outcome-`));
  const outcomeCard = page.getByRole('region', { name: /Log the outcome of/ });
  await expect(outcomeCard).toBeVisible();
  await expect(outcomeCard.getByLabel('What happened')).toBeFocused();
});

test('the calendar moves between months and lists a chosen day', async ({ page }) => {
  await signUpViaApi(page);
  const client = await createClient(page);
  const day = istDay(40);
  const res = await page.request.post('/api/cases', {
    data: {
      clientId: client.id,
      title: 'State vs. Kulkarni',
      caseNumber: 'BA/77/2026',
      courtName: 'Sessions Court, Pune',
      firstHearing: { date: day, time: '11:00' },
    },
  });
  expect(res.status()).toBe(201);

  await page.goto('/calendar');
  const monthHeading = page.getByRole('heading', { level: 2 }).first();
  const thisMonth = await monthHeading.textContent();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(monthHeading).not.toHaveText(thisMonth!);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(monthHeading).toHaveText(thisMonth!);

  await page.goto(`/calendar?month=${day.slice(0, 7)}`);
  const cell = page.getByRole('button', { name: /: 1 hearing$/ });
  await cell.click();
  const dayPanel = page.getByRole('region', { name: /^Hearings on / });
  await expect(dayPanel.getByText('State vs. Kulkarni')).toBeVisible();

  // The arrow keys move between days (staying inside the month).
  const [away, back] = day.endsWith('-01')
    ? ['ArrowRight', 'ArrowLeft']
    : ['ArrowLeft', 'ArrowRight'];
  await page.keyboard.press(away);
  await expect(dayPanel.getByText('No hearings on this day.')).toBeVisible();
  await page.keyboard.press(back);
  await expect(dayPanel.getByText('State vs. Kulkarni')).toBeVisible();
  await expect(cell).toBeFocused();
});

test('@mobile the calendar is a list grouped by day on a small screen', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'mobile layout only');
  await signUpViaApi(page);
  const client = await createClient(page);
  const day = istDay(3);
  await page.request.post('/api/cases', {
    data: {
      clientId: client.id,
      title: 'State vs. Kulkarni',
      caseNumber: 'BA/77/2026',
      courtName: 'Sessions Court, Pune',
      firstHearing: { date: day, time: '11:00' },
    },
  });

  await page.goto(`/calendar?month=${day.slice(0, 7)}`);
  await expect(page.getByRole('table')).toHaveCount(0);
  const group = page.getByRole('region', { name: dayLabel(day) });
  await expect(group).toBeVisible();
  await expect(group.getByText('11:00 AM')).toBeVisible();
  await expect(group.getByText('State vs. Kulkarni')).toBeVisible();
});
