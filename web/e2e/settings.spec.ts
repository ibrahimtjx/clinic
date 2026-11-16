import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

test('admin prices and activates a service', async ({ page }) => {
  const code = `T${Date.now().toString(36).toUpperCase().slice(-6)}`;
  await signIn(page, 'admin');
  await page.goto('/settings/services');
  await expect(page.getByTestId('services-table')).toBeVisible();
  await page.getByRole('button', { name: 'خدمة جديدة' }).click();
  const form = page.getByTestId('service-form');
  await form.locator('input').nth(0).fill(code);
  await form.getByLabel('الاسم بالعربية').fill('حشوة تجريبية');
  await form.getByLabel('الاسم بالإنجليزية').fill('Test filling');
  await form.getByLabel('سعر البيع').fill('250.5');
  await form.getByLabel('أقل سعر').fill('200');
  await form.getByLabel('أعلى سعر').fill('300');
  await form.locator('button[type="submit"]').click();
  await expect(page.getByTestId(`service-${code}`)).toContainText('250.50');
});

test('admin adds a doctor with working hours', async ({ page }) => {
  const name = `د. تجربة ${Date.now().toString(36)}`;
  await signIn(page, 'admin');
  await page.goto('/settings/doctors');
  await page.getByTestId('new-doctor').click();
  const form = page.getByTestId('doctor-form');
  await form.getByLabel('الاسم بالعربية').fill(name);
  await page.getByTestId('day-0').dispatchEvent('click');
  await page.getByTestId('day-1').dispatchEvent('click');
  await form.locator('button[type="submit"]').click();
  const row = page.getByTestId('doctors-table').locator('tr', { hasText: name });
  await expect(row).toContainText('الأحد');
  await expect(row).toContainText('الاثنين');
});

test('settings sections, seeded statuses and numbering', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings/statuses');
  await expect(page.getByTestId('statuses-tab')).toContainText('عند الطبيب');
  await page.getByTestId('settings-nav-numbering').click();
  await expect(page.getByTestId('numbering-table')).toContainText(/INV-\d{4}-\d{6}/);
  await expect(page.getByTestId('clinic-name')).toContainText('اللؤلؤة البيضاء');
});

test('system health page lists the servers reporting (SPEC 15.4)', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'admin');
  await page.goto('/settings/system-health');
  await expect(page.getByTestId('health-status')).toBeVisible();
  // The ops service on this server reports every minute.
  await expect(page.getByTestId('health-nodes').locator('tbody tr').first()).toBeVisible({ timeout: 90_000 });
});

test('the doctor room shows on the doctors list and on the department page', async ({ page }) => {
  const name = `د. غرفة ${Date.now().toString(36)}`;
  const room = `غرفة ${Date.now() % 1000}`;
  await signIn(page, 'admin');
  await page.goto('/settings/doctors');
  await page.getByTestId('new-doctor').click();
  const form = page.getByTestId('doctor-form');
  await form.getByLabel('الاسم بالعربية').fill(name);
  await form.getByRole('textbox', { name: 'القسم' }).click();
  await page.getByRole('option', { name: 'الأشعة' }).click();
  await page.getByTestId('doctor-room').fill(room);
  await form.locator('button[type="submit"]').click();
  await expect(page.getByTestId('doctors-table').locator('tr', { hasText: name })).toContainText(room);

  await page.getByTestId('settings-nav-departments').click();
  await page.getByTestId('departments-tab').getByRole('button', { name: 'الأشعة' }).click();
  const ov = page.getByTestId('department-overview');
  await expect(ov.locator('tr', { hasText: name })).toContainText(room);
  await expect(ov).toContainText('المرضى');
});
