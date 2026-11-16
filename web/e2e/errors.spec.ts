import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

test('a wrong address shows a page-not-found screen inside the app', async ({ page }) => {
  await signIn(page, 'reception');
  await page.goto('/no-such-page');
  await expect(page.getByTestId('not-found')).toContainText(/الصفحة غير موجودة|Page not found/);
  await page.getByRole('link', { name: /العودة إلى البداية|Back to the start/ }).click();
  await expect(page.getByTestId('server-time')).toBeVisible();
});

test('a report with the end date before the start explains the problem', async ({ page }) => {
  await signIn(page, 'cashier');
  await page.goto('/reports/revenue?date_from=2027-02-01&date_to=2027-01-01');
  await expect(page.getByTestId('report-view')).toContainText(/تحقق من التواريخ|Check the dates/);
});
