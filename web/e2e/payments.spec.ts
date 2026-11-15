import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

test('reception collects a split payment, cashier credits the invoice, reception closes the shift', async ({ page, browser }) => {
  // Doctor side (admin): a payment order sent to reception.
  await signIn(page, 'admin');
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill('خالد');
  const row = page.getByTestId('patients-table').locator('tbody tr').first();
  await expect(row.locator('mark').first()).toBeVisible();
  await row.click();
  await page.getByTestId('tab-billing').click();
  await page.getByTestId('new-payment-order').click();
  await page.getByTestId('line-service-0').fill('DN005');
  await page.getByRole('option', { name: /DN005/ }).click();
  await expect(page.getByTestId('line-0').locator('td').nth(6)).not.toHaveText('—');
  await page.getByTestId('send-to-reception').click();
  await expect(page.getByTestId('doc-number')).toContainText(/^PO-/);
  const orderNo = await page.getByTestId('doc-number').innerText();

  // Reception: inbox → collect with cash + Mada.
  const rctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const reception = await rctx.newPage();
  await signIn(reception, 'reception');
  await reception.goto('/billing/inbox');
  const inboxRow = reception.getByTestId('inbox').locator('tr', { hasText: orderNo });
  await inboxRow.getByRole('button').click();
  await expect(reception.getByTestId('collect-due')).toBeVisible();
  await reception.getByTestId('amount-0').fill('100');
  await reception.getByTestId('add-method').click();
  await expect(reception.getByTestId('amount-1')).not.toHaveValue('0.00');
  await expect(reception.getByTestId('to-balance')).toHaveCount(0);
  await reception.getByTestId('confirm-collect').click();
  await expect(reception.getByTestId('issued-invoice-no')).toContainText(/^INV-\d{4}-\d{6}$/);
  const invoiceNo = await reception.getByTestId('issued-invoice-no').innerText();
  await reception.getByRole('button', { name: 'فتح الفاتورة' }).click();
  await expect(reception.getByTestId('invoice-state')).toHaveText('مسددة');
  const invoiceUrl = reception.url();
  // Reception cannot issue credit notes.
  await expect(reception.getByTestId('credit-note')).toHaveCount(0);

  // Cashier: credit the whole invoice and keep the money on the patient's account.
  const cctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const cashier = await cctx.newPage();
  await signIn(cashier, 'cashier');
  await cashier.goto(invoiceUrl);
  await expect(cashier.getByRole('heading', { name: new RegExp(invoiceNo) })).toBeVisible();
  await cashier.getByTestId('credit-note').click();
  await cashier.getByTestId('credit-all').click();
  await cashier.getByTestId('credit-reason').fill('الخدمة لم تُنفذ');
  await cashier.getByTestId('keep-on-account').click();
  await cashier.getByTestId('confirm-credit').click();
  await expect(cashier.getByTestId('credit-done')).toContainText(/CN-\d{4}-\d{6}/);
  await cctx.close();

  // Reception: the shift shows the payment; close it.
  await reception.goto('/billing/cash-box');
  await expect(reception.getByTestId('box-mada-in')).toBeVisible(); // only methods with money show
  const popup = reception.waitForEvent('popup');
  await reception.getByTestId('close-box').click();
  await reception.getByTestId('confirm-close').click();
  const slip = await popup;
  await expect(slip.getByTestId('closing-print')).toBeVisible();
  await expect(reception.getByTestId('closings').locator('tbody tr').first()).toBeVisible();
  await rctx.close();
});
