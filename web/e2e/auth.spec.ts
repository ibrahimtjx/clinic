import { expect, test } from '@playwright/test';

import { DEV_PASSWORD, DEV_PIN, signIn } from './helpers';

test('wrong password shows an error; API rejects unauthenticated calls', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('input[name="username"]').fill('cashier');
  await page.locator('input[name="password"]').fill('not-the-password');
  await page.locator('[data-testid="login-form"] button[type="submit"]').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  expect((await request.get('/api/users')).status()).toBe(401);
});

test('lock keeps open work; unlock with PIN; quick switch to another user', async ({ page }) => {
  await signIn(page, 'reception');
  await page.goto('/design');
  const name = page.locator('#inline-form input').first();
  await name.fill('unsaved work');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('lock').click();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  // The old session is gone on the server.
  expect((await page.request.post('/api/auth/refresh')).status()).toBe(401);

  await page.getByTestId('lock-pin').fill(DEV_PIN);
  await page.getByTestId('lock-pin').press('Enter');
  await expect(page.getByTestId('lock-screen')).toBeHidden();
  await expect(name).toHaveValue('unsaved work');

  // Quick switch: a doctor signs in over the receptionist's open screen.
  await page.keyboard.press('Control+l');
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await page.getByTestId('lock-switch').click();
  await page.getByTestId('lock-username').fill('dr.reem');
  await page.getByTestId('lock-pin').fill(DEV_PIN);
  await page.getByTestId('lock-pin').press('Enter');
  await expect(page.getByTestId('lock-screen')).toBeHidden();
  await expect(name).toHaveValue('unsaved work');
  await page.getByTestId('user-menu').click();
  await expect(page.getByTestId('current-user')).toContainText(/ريم|Reem/);
});

test('admin creates a user who must set a password at first sign-in; audit log records it', async ({ page, browser }) => {
  const username = `e2e.${Date.now().toString(36)}`;
  await signIn(page, 'admin');
  await page.goto('/settings/users');
  await page.getByTestId('new-user').click();
  const form = page.getByTestId('user-form');
  await form.locator('input').nth(0).fill(username);
  await form.locator('input').nth(1).fill('مستخدم تجربة');
  await form.locator('input').nth(2).fill('E2E user');
  await form.locator('input[type="password"]').fill('Temp-Pass-2026');
  await form.getByRole('checkbox').nth(2).check(); // reception
  await form.locator('button[type="submit"]').click();
  await expect(page.getByTestId(`user-row-${username}`)).toBeVisible();

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const other = await ctx.newPage();
  await signIn(other, username, 'Temp-Pass-2026').catch(() => {});
  await expect(other.getByTestId('must-change-password')).toBeVisible();
  const pw = other.getByTestId('change-password-form').locator('input[type="password"]');
  await pw.nth(0).fill('Temp-Pass-2026');
  await pw.nth(1).fill('My-Own-Pass-2026');
  await pw.nth(2).fill('My-Own-Pass-2026');
  await other.getByTestId('change-password-form').locator('button[type="submit"]').click();
  await expect(other.getByTestId('must-change-password')).toBeHidden();
  await ctx.close();

  await page.goto('/settings/audit');
  const table = page.getByTestId('audit-table');
  await expect(table).toContainText('إنشاء'); // create
  await expect(table).toContainText('تسجيل دخول'); // sign-in
});

test('permission matrix hides settings from reception', async ({ page }) => {
  await signIn(page, 'reception', DEV_PASSWORD);
  await expect(page.locator('a[href="/settings"]')).toHaveCount(0);
  await page.goto('/settings/users');
  await expect(page.getByText('ليست لديك صلاحية لأي من الإعدادات.')).toBeVisible();
});
