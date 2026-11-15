import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

test('doctor records a visit on selected teeth, marks the chart, and adds an addendum', async ({ page }) => {
  await signIn(page, 'dr.reem');
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill('محمد');
  const row = page.getByTestId('patients-table').locator('tbody tr').first();
  await expect(row.locator('mark').first()).toBeVisible();
  await row.click();
  await page.getByTestId('tab-dental').click();
  await expect(page.getByTestId('tooth-chart')).toBeVisible();

  await page.getByTestId('new-visit').click();
  await page.getByTestId('tooth-36').click();
  await page.getByTestId('tooth-37').click();
  await expect(page.getByTestId('selected-teeth')).toContainText('36');
  const form = page.getByTestId('visit-form');
  const note = `ألم عند المضغ ${Date.now().toString().slice(-5)}`;
  await form.locator('textarea[name="chief_complaint"]').fill(note);
  await form.locator('textarea[name="diagnosis"]').fill('تسوس عميق');
  await page.getByTestId('save-visit').click();
  await expect(page.locator('[data-testid^="visit-"]').first()).toContainText('تسوس عميق');

  await page.getByTestId('mark-teeth').click();
  await page.getByTestId('mark-restoration').click();
  await expect(page.getByTestId('marker-36-restoration').first()).toBeVisible();

  await page.getByTestId('addendum-text').fill('تمت المتابعة');
  await page.getByTestId('addendum-save').click();
  await expect(page.getByTestId('addenda')).toContainText('تمت المتابعة');
});

test('reception cannot open the dental record', async ({ page }) => {
  await signIn(page, 'reception');
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill('محمد');
  const row = page.getByTestId('patients-table').locator('tbody tr').first();
  await expect(row.locator('mark').first()).toBeVisible();
  await row.click();
  await expect(page.getByTestId('patient-header')).toBeVisible();
  await expect(page.getByTestId('tab-dental')).toHaveCount(0);
});
