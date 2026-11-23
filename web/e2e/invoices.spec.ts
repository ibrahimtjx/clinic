import { expect, request, test, type APIRequestContext } from '@playwright/test';

import { signIn } from './helpers';

/** A doctor writes a bill for a new patient and sends it to reception (through the API). */
async function bill(baseURL: string | undefined, price: string) {
  const api: APIRequestContext = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const login = async (u: string) => ({ Authorization: `Bearer ${(await (await api.post('/api/auth/login', { data: { username: u, password: 'Clinic-dev-2026' } })).json()).access_token}` });
  const desk = await login('reception');
  const pt = await (await api.post('/api/patients', { headers: desk, data: { name_ar: `مريض فواتير ${Date.now() % 100000}`, allow_duplicate: true } })).json();
  const dr = await login('dr.reem');
  const svc = (await (await api.get('/api/services', { headers: dr })).json()).find((s: { sale_price: string }) => Number(s.sale_price) >= 200);
  let po = await (await api.post('/api/payment-orders', { headers: dr, data: { patient_id: pt.id, lines: [{ service_id: svc.id, price }] } })).json();
  po = await (await api.post(`/api/payment-orders/${po.id}/send`, { headers: dr, data: { version: po.version } })).json();
  await api.dispose();
  return { patientId: pt.id as number, order: po as { id: number; order_no: string; patient_share: string } };
}

test('a part payment issues an invoice for what was paid; the rest is paid later from the account', async ({ page, baseURL }) => {
  const { patientId, order } = await bill(baseURL, '1000');
  await signIn(page, 'reception');
  await page.goto('/billing/inbox');
  await page.getByTestId(`collect-${order.id}`).click();
  await page.getByTestId('amount-0').fill('300');
  await expect(page.getByTestId('to-balance')).toContainText(/300/);
  await page.getByTestId('confirm-collect').click();
  await expect(page.getByTestId('bill-remaining')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`/patients/${patientId}/billing`);
  const row = page.getByTestId(`bill-${order.order_no}`);
  await expect(row).toBeVisible();
  await page.getByTestId(`pay-bill-${order.id}`).click();
  await page.getByTestId('confirm-collect').click();
  await expect(page.getByTestId('issued-invoice-no')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('unpaid-bills')).toHaveCount(0);
});

test('pay later, then the cashier closes the rest with a reason', async ({ page, baseURL }) => {
  const { patientId, order } = await bill(baseURL, '500');
  await signIn(page, 'reception');
  await page.goto('/billing/inbox');
  await page.getByTestId(`collect-${order.id}`).click();
  await page.getByTestId('amount-0').fill('0');
  await page.getByTestId('confirm-collect').click();
  await expect(page.getByTestId('bill-owed')).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, 'cashier');
  await page.goto(`/patients/${patientId}/billing`);
  await page.getByTestId(`close-bill-${order.id}`).click();
  await page.getByTestId('close-reason').fill('سماح من الإدارة');
  await page.getByTestId('confirm-close').click();
  await expect(page.getByTestId('unpaid-bills')).toHaveCount(0);
  await expect(page.getByTestId('account-balance')).toContainText('0.00');
});

test('a manager corrects an issued invoice', async ({ page, baseURL }) => {
  const { order } = await bill(baseURL, '400');
  await signIn(page, 'reception');
  await page.goto('/billing/inbox');
  await page.getByTestId(`collect-${order.id}`).click();
  await page.getByTestId('confirm-collect').click();
  await page.getByRole('button', { name: /فتح الفاتورة|Open invoice/ }).click();
  const url = page.url();

  await page.context().clearCookies();
  await signIn(page, 'manager');
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  await page.getByTestId('correct-invoice').click();
  await page.getByTestId('correct-price-0').fill('350');
  await page.getByTestId('correct-reason').fill('السعر المتفق عليه 350');
  await page.getByTestId('confirm-correct').click();
  await expect(page.getByTestId('correct-done')).toBeVisible();
  await page.getByTestId('open-corrected').click();
  await expect(page.getByTestId('invoice-links')).toContainText(/INV-/);
});
