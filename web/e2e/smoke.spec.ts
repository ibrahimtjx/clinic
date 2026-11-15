import { expect, test } from '@playwright/test';

test('app loads over the stack, talks to the API, and toggles language and theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
  await expect(page.getByTestId('server-time')).toContainText('/');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('toggle-language').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('toggle-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
});

test('Ctrl+K palette navigates to the design page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
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
  await page.goto('/design');
  await expect(page.getByTestId('design-page')).toBeVisible();
});

test('API health is reachable through the proxy', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).timezone).toBe('Asia/Riyadh');
});
