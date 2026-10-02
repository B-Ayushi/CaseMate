import { expect, type Page } from '@playwright/test';

let counter = 0;

export const PASSWORD = 'e2epass123';

export function uniqueEmail(label = 'advocate') {
  counter += 1;
  return `${label}-${Date.now()}-${counter}@example.com`;
}

// Creates an account through the API (the signup form itself is covered in auth.spec)
// and leaves the browser logged in.
export async function signUpViaApi(page: Page, name = 'Priya Sharma') {
  const email = uniqueEmail();
  const res = await page.request.post('/api/auth/signup', {
    data: {
      name,
      email,
      phone: '98220 12345',
      barCouncilNumber: 'MAH/2041/2012',
      password: PASSWORD,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { email, name };
}
