import { expect, request, test } from '@playwright/test';

import { ownPatient, signIn } from './helpers';

test('welcome page greets the user by name', async ({ page }) => {
  await signIn(page, 'reception');
  await expect(page.getByTestId('welcome-name')).toContainText(/أمل|Amal/);
});

test('a doctor sees only their own column in the calendar; reception sees everyone', async ({ page }) => {
  await signIn(page, 'dr.reem');
  await page.goto('/appointments');
  await expect(page.locator('[data-testid^="col-"]').first()).toBeVisible();
  const ids = await page.locator('[data-testid^="col-"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-testid')!.split('-')[1]))]);
  expect(ids.length).toBe(1);
  await expect(page.getByTestId('open-reminders')).toHaveCount(0);
});

test('doctor writes a sick leave with dates and prints it', async ({ page, baseURL }) => {
  const pt = await ownPatient(baseURL, 'dr.reem', `مريضة إجازة ${Date.now() % 100000}`);
  await signIn(page, 'dr.reem');
  await page.goto(`/patients/${pt.id}`);
  await page.getByTestId('tab-prescriptions').click();
  await page.getByText(/إجازة مرضية|Sick leave/).first().click();
  await page.getByTestId('new-sick-leave').click();
  await expect(page.getByTestId('leave-days')).toContainText('1');
  await page.getByTestId('save-report').click();
  const card = page.locator('[data-testid^="leave-"]').first();
  await expect(card).toContainText(/1\)/);
  const popup = page.waitForEvent('popup');
  await page.locator('[data-testid^="report-"]').filter({ has: card }).getByRole('button', { name: /طباعة|Print/ }).first().click();
  const print = await popup;
  await expect(print.getByTestId('leave-print')).toContainText(/1/);
});

test('reception opens WhatsApp with the reminder for tomorrow', async ({ page, context, baseURL }) => {
  await context.route('https://wa.me/**', (route) => route.fulfill({ status: 200, body: 'whatsapp' }));
  // Book an appointment tomorrow for a patient with a mobile number.
  const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const tok = (await (await api.post('/api/auth/login', { data: { username: 'reception', password: 'Clinic-dev-2026' } })).json()).access_token;
  const H = { Authorization: `Bearer ${tok}` };
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const slots = await (await api.get(`/api/appointments/free-slots?from=${tomorrow}&to=${tomorrow}&duration=15&limit=40`, { headers: H })).json();
  const pts = await (await api.get('/api/patients?page_size=50', { headers: H })).json();
  const pt = pts.items.find((x: { mobile: string | null }) => x.mobile);
  for (const s of slots) {
    const r = await api.post('/api/appointments', { headers: H, data: { patient_id: pt.id, doctor_id: s.doctor_id, starts_at: s.starts_at, ends_at: s.ends_at, acknowledge: ['same_day', 'outside_hours'] } });
    if (r.ok()) break;
  }
  await api.dispose();
  await signIn(page, 'reception');
  await page.goto('/appointments');
  await page.getByTestId('open-reminders').click();
  const table = page.getByTestId('reminders-table');
  await expect(table).toBeVisible();
  const popup = context.waitForEvent('page');
  await table.locator('[data-testid^="wa-"]').first().click();
  await page.getByTestId('wa-ar').click();
  const wa = await popup;
  expect(wa.url()).toMatch(/^https:\/\/wa\.me\/9665\d{8}\?text=/);
  expect(decodeURIComponent(wa.url().split('text=')[1])).toContain('نذكّرك بموعدك');
});
