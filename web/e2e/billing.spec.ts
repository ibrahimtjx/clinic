import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

test('doctor writes a quotation, converts it, sends to reception; reception sees it waiting', async ({ page, browser }) => {
  await signIn(page, 'admin');
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill('محمد');
  const row = page.getByTestId('patients-table').locator('tbody tr').first();
  await expect(row.locator('mark').first()).toBeVisible();
  await row.click();
  await page.getByTestId('profile-new-quotation').click();
  await expect(page.getByTestId('document-editor')).toBeVisible();

  await page.getByTestId('line-service-0').fill('DN005');
  await page.getByRole('option', { name: /DN005/ }).click();
  await expect(page.getByTestId('patient-due')).not.toHaveText('—');
  await page.getByTestId('add-line').click();
  await page.getByTestId('line-service-1').fill('DN019');
  await page.getByRole('option', { name: /DN019/ }).click();
  // Wait for the live preview to include the second line.
  await expect(page.getByTestId('line-1').locator('td').nth(6)).not.toHaveText('—');
  // Price outside the range is refused for users without the override permission; admin may override.
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('doc-number')).toContainText(/^Q-\d{4}-\d{6}$/);
  const total = await page.getByTestId('patient-due').innerText();

  await page.getByTestId('convert').click();
  await expect(page.getByTestId('doc-number')).toContainText(/^PO-/);
  await expect(page.getByTestId('patient-due')).toHaveText(total);
  const orderNo = await page.getByTestId('doc-number').innerText();
  await page.getByTestId('send-to-reception').click();
  await expect(page.getByText('مُرسل').first()).toBeVisible();

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const reception = await ctx.newPage();
  await signIn(reception, 'reception');
  await reception.getByTestId('notifications').click();
  await expect(reception.getByTestId('waiting-orders')).toBeVisible();
  await reception.goto('/billing');
  await expect(reception.getByTestId('inbox')).toContainText(orderNo);
  await ctx.close();
});

test('treatment plan: option with a price, accept it, create a payment schedule', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill('نورة');
  const row = page.getByTestId('patients-table').locator('tbody tr').first();
  await expect(row.locator('mark').first()).toBeVisible();
  await row.click();
  await page.getByTestId('tab-plans').click();
  await page.getByTestId('new-plan').click();
  const form = page.getByTestId('plan-form');
  await page.getByTestId('plan-title').fill(`تقويم ${Date.now().toString().slice(-5)}`);
  await form.getByRole('textbox', { name: 'الطبيب' }).click();
  await page.getByRole('option').first().click();
  await page.getByTestId('add-option').click();
  await form.getByLabel('البديل').fill('تقويم ثابت');
  await form.getByLabel('السعر').fill('9000');
  await page.getByTestId('add-session').click();
  await form.getByLabel('وصف الجلسة').fill('تركيب التقويم');
  await page.getByTestId('save-plan').click();
  await page.getByTestId('accept-option-0').click();
  await expect(form.getByText('مقبولة').first()).toBeVisible();
  await page.getByTestId('generate-installments').click();
  await page.getByTestId('generate-ok').click();
  await expect(page.getByTestId('installments').locator('tbody tr')).toHaveCount(6);
});
