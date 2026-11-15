import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

test('send from the profile, then call, start and finish; totals update', async ({ page }) => {
  await signIn(page, 'reception');
  // A fresh patient so repeated runs do not hit "already in queue".
  await page.goto('/patients');
  await page.getByTestId('new-patient').click();
  const name = `مراجع ${Date.now().toString().slice(-6)}`;
  await page.getByTestId('new-patient-form').locator('input[name="name_ar"]').fill(name);
  await page.getByTestId('new-patient-form').locator('button[type="submit"]').click();
  await expect(page.getByTestId('patient-header')).toContainText(name);

  await page.getByTestId('profile-send').click();
  await page.getByTestId('send-doctor').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('send-ok').click();
  await expect(page.getByText(/رقمه في الانتظار/)).toBeVisible();

  await page.goto('/queue');
  await page.getByText('لوحة', { exact: true }).click();
  const card = page.getByTestId('queue-board').locator('[data-testid^="queue-card-"]', { hasText: name });
  await expect(card).toBeVisible();
  await card.getByTestId('q-call').click();
  await expect(page.getByTestId('queue-col-called').getByText(name)).toBeVisible();
  await page.getByTestId('queue-col-called').locator('[data-testid^="queue-card-"]', { hasText: name }).getByTestId('q-start').click();
  await expect(page.getByTestId('queue-col-with_doctor').getByText(name)).toBeVisible();
  await page.getByTestId('queue-col-with_doctor').locator('[data-testid^="queue-card-"]', { hasText: name }).getByTestId('q-finish').click();
  await expect(page.getByTestId('queue-col-done').getByText(name)).toBeVisible();

  await page.getByText('جدول', { exact: true }).click();
  await expect(page.getByTestId('queue-table')).toContainText(name);
  await expect(page.getByTestId('queue-totals')).toBeVisible();
});
