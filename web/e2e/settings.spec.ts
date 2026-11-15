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
  await expect(page.getByTestId('numbering-table')).toContainText(/INV-\d{4}-000001/);
  await expect(page.getByTestId('clinic-name')).toContainText('مجمع الندى');
});
