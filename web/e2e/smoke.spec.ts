import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

test('signed out shows the login page in Arabic RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('login-form')).toBeVisible();
});

test('signs in, talks to the API, and toggles language and theme', async ({ page }) => {
  await signIn(page, 'manager');
  await expect(page.getByTestId('server-time')).toContainText('/');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('toggle-language').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('toggle-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');

  // The session survives a reload (refresh cookie) and the preferences come from the profile.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByTestId('server-time')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');

  // Put the shared seed user back the way it was.
  await page.getByTestId('user-menu').click();
  await page.getByTestId('toggle-language').click();
  await page.getByTestId('user-menu').click();
  await page.getByTestId('toggle-theme').click();
  await page.waitForTimeout(800);
});

test('Ctrl+K palette navigates to the design page', async ({ page }) => {
  await signIn(page);
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('اكتب أمراً أو ابحث…');
  await expect(input).toBeFocused();
  await input.fill('دليل');
  await expect(page.locator('.mantine-Spotlight-action')).toHaveCount(1);
  await input.press('Enter');
  await expect(page).toHaveURL(/\/design$/);
  await expect(page.getByTestId('design-page')).toBeVisible();
});

test('deep links work (SPA fallback)', async ({ page }) => {
  await signIn(page);
  await page.goto('/design');
  await expect(page.getByTestId('design-page')).toBeVisible();
});

test('API health is reachable through the proxy', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).timezone).toBe('Asia/Riyadh');
});
