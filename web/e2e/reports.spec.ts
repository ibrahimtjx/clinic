import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

test('cashier runs the revenue report, prints it and downloads Excel; statement for a patient', async ({ page }) => {
  await signIn(page, 'cashier');
  await page.goto('/reports');
  await page.getByTestId('report-revenue').click();
  await expect(page.getByTestId('section-detail')).toBeVisible();
  await expect(page.getByTestId('report-summary')).toContainText('عدد الفواتير');

  const popup = page.waitForEvent('popup');
  await page.getByTestId('report-print').click();
  const print = await popup;
  await expect(print.getByTestId('print-page')).toContainText('تقرير الإيرادات / Revenue report');
  await expect(print.getByTestId('report-print')).toContainText('الملخص');

  const download = page.waitForEvent('download');
  await page.getByTestId('report-excel').click();
  expect((await download).suggestedFilename()).toMatch(/^revenue-report-\d{8}\.xlsx$/);
  const pdf = page.waitForEvent('download');
  await page.getByTestId('report-pdf').click();
  expect((await pdf).suggestedFilename()).toMatch(/^revenue-report-\d{8}\.pdf$/);

  await page.goto('/reports/account_statement');
  await page.getByTestId('filter-patient').fill('خالد');
  await page.getByRole('option').first().click();
  await page.getByTestId('report-run').click();
  await expect(page.getByTestId('section-statement')).toBeVisible();
  await expect(page.getByTestId('report-summary')).toContainText('الرصيد الختامي المستحق');
});

test('reception sees operational reports only', async ({ page }) => {
  await signIn(page, 'reception');
  await page.goto('/reports');
  await expect(page.getByTestId('report-daily_schedule')).toBeVisible();
  await expect(page.getByTestId('report-revenue')).toHaveCount(0);
  await page.getByTestId('report-daily_schedule').click();
  await expect(page.getByTestId('report-body')).toBeVisible();
});
