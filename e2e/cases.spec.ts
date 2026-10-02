import { expect, test, type Page } from '@playwright/test';
import { dayLabel, db, istDay } from './db';
import { signUpViaApi } from './helpers';

async function createClient(page: Page, name = 'Ramesh Gupta') {
  const res = await page.request.post('/api/clients', {
    data: { name, phone: '9822011223', preferredContact: 'PHONE', hourlyRatePaise: 300000 },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).client as { id: string };
}

async function fillCaseForm(page: Page, date: string) {
  await page.getByLabel('Title').fill('Gupta vs. Mehta Builders');
  await page.getByLabel('Case number').fill('RCS/412/2026');
  await page.getByRole('textbox', { name: 'Court', exact: true }).fill('Civil Court, Pune');
  await page.getByLabel('Courtroom').fill('Room 4');
  await page.getByLabel('Date').fill(date);
  await page.getByLabel('Time (IST)').fill('10:30');
  await page.getByLabel('Purpose').fill('Evidence');
  await page.getByLabel('Note for this hearing').fill('Bring the original sale agreement');
}

test('add a case with its first hearing and see its reminders', async ({ page }) => {
  await signUpViaApi(page);
  await createClient(page);
  await page.goto('/cases');

  await expect(page.getByRole('heading', { name: 'No cases yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Add your first case' }).click();

  // The server rejects a date in the past and the message lands on the date field.
  await page.getByLabel('Client').selectOption({ label: 'Ramesh Gupta' });
  await fillCaseForm(page, istDay(-2));
  await page.getByRole('button', { name: 'Save case' }).click();
  await expect(page.getByText('Choose a date and time in the future')).toBeVisible();

  await page.getByLabel('Date').fill(istDay(10));
  await page.getByLabel('SMS reminders').selectOption('off');
  await page.getByRole('button', { name: 'Save case' }).click();

  await expect(page.getByRole('heading', { name: 'Gupta vs. Mehta Builders' })).toBeVisible();
  const next = page.getByRole('region', { name: 'Next hearing' });
  await expect(next).toBeVisible();
  // Shown in IST although this browser runs on London time.
  await expect(
    page
      .getByRole('region', { name: 'Next hearing' })
      .getByText(dayLabel(istDay(10)), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('10:30 AM · Civil Court, Pune, Room 4')).toBeVisible();
  // SMS is off for this case, so only the two email reminders are planned.
  await expect(page.getByText('Day before', { exact: true })).toBeVisible();
  await expect(page.getByText('Outcome nudge', { exact: true })).toBeVisible();
  await expect(page.getByText('2 hours before')).toHaveCount(0);

  // Moving the hearing re-plans its reminders.
  await page.getByRole('button', { name: 'Change date' }).click();
  await page.getByLabel('Date').fill(istDay(12));
  await page.getByRole('button', { name: 'Save new date' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Next hearing' })
      .getByText(dayLabel(istDay(12)), { exact: true }),
  ).toBeVisible();

  const hearing = await db.hearing.findFirstOrThrow({
    where: { case: { title: 'Gupta vs. Mehta Builders' }, status: 'SCHEDULED' },
    include: { reminders: true },
    orderBy: { createdAt: 'desc' },
  });
  expect(hearing.reminders.filter((r) => r.status === 'PENDING')).toHaveLength(2);
  expect(hearing.reminders.filter((r) => r.status === 'CANCELLED')).toHaveLength(2);

  await page.getByRole('link', { name: '← All cases' }).click();
  await expect(page.getByText('RCS/412/2026 · Ramesh Gupta')).toBeVisible();
});

test('add a client from the case form and come back to it', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/cases/new');

  await expect(page.getByText('You have no clients yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Add a client' }).click();
  await page.getByLabel('Name').fill('Sunita Patil');
  await page.getByLabel('Mobile number').fill('9900112233');
  await page.getByRole('button', { name: 'Add client' }).click();

  await expect(page).toHaveURL(/\/cases\/new\?clientId=/);
  await expect(page.getByLabel('Client')).toHaveValue(/.+/);
  await expect(page.getByLabel('Client').locator('option:checked')).toHaveText('Sunita Patil');
});

test('log an outcome with time spent and the next date', async ({ page }) => {
  await signUpViaApi(page);
  const client = await createClient(page);
  const created = await page.request.post('/api/cases', {
    data: {
      clientId: client.id,
      title: 'State vs. Kulkarni',
      caseNumber: 'BA/77/2026',
      courtName: 'Sessions Court, Pune',
      firstHearing: { date: istDay(5), time: '11:00', purpose: 'Bail hearing' },
    },
  });
  const caseId = (await created.json()).case.id as string;
  // The hearing took place an hour ago (only possible to set up in the database).
  await db.hearing.updateMany({
    where: { caseId },
    data: { scheduledAt: new Date(Date.now() - 60 * 60 * 1000) },
  });

  await page.goto(`/cases/${caseId}`);
  const outcomeCard = page.getByRole('region', { name: /Log the outcome of/ });
  await expect(outcomeCard).toBeVisible();

  await outcomeCard.getByLabel('What happened').selectOption('ADJOURNED');
  await outcomeCard.getByLabel('Notes').fill('Prosecution sought time to file reply');
  await outcomeCard.getByLabel('Hours').fill('1');
  await outcomeCard.getByLabel('Minutes').fill('30');
  await outcomeCard.getByRole('textbox', { name: 'Next date', exact: true }).fill(istDay(21));
  await outcomeCard.getByLabel('Time (IST)').fill('11:00');
  await outcomeCard.getByLabel('Purpose').fill('Reply and arguments');
  await outcomeCard.getByRole('button', { name: 'Save outcome' }).click();

  await expect(page.getByText('Log the outcome of')).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: 'Next hearing' })
      .getByText(dayLabel(istDay(21)), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Adjourned')).toBeVisible();
  await expect(page.getByText('Prosecution sought time to file reply')).toBeVisible();
  await expect(page.getByText('Time spent: 1 h 30 min')).toBeVisible();
  // 1.5 hours at the client's ₹3,000 an hour, on the case's billing tab.
  await page.getByRole('tab', { name: 'Time and billing' }).click();
  const time = page.getByRole('tabpanel', { name: 'Time and billing' });
  await expect(time.getByText('Hearing: Adjourned')).toBeVisible();
  await expect(time.getByText(/1 h 30 min · ₹4,500/)).toBeVisible();
  await expect(time.getByText('Unbilled', { exact: true })).toBeVisible();

  const entry = await db.timeEntry.findFirstOrThrow({ where: { caseId } });
  expect(entry.amountPaise).toBe(450000);
});
