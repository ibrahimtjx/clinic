import { expect, test } from '@playwright/test';

import { signIn } from './helpers';

const uniq = () => Date.now().toString().slice(-8);

test('register a patient, find them with a spelling variant, edit, open health, assign', async ({ page }) => {
  const n = uniq();
  const mobile = `05${n}`;
  await signIn(page, 'admin');
  await page.goto('/patients');
  await page.getByTestId('new-patient').click();
  const form = page.getByTestId('new-patient-form');
  await form.locator('input[name="name_ar"]').fill(`فاطمة تجربة ${n}`);
  await form.locator('input[name="name_en"]').fill(`Fatimah Test ${n}`);
  await form.locator('input[name="mobile"]').fill(mobile);
  await form.locator('button[type="submit"]').click();
  await expect(page.getByTestId('patient-header')).toContainText(`فاطمة تجربة ${n}`);
  const fileNo = await page.getByTestId('file-no').innerText();

  // Search: ta marbuta typed as ha, plus the number.
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill(`فاطمه تجربه ${n}`);
  const row = page.getByTestId(`patient-row-${fileNo}`);
  await expect(row).toBeVisible();
  await expect(row.locator('mark').first()).toBeVisible();
  await page.getByTestId('patient-search').fill(mobile.slice(3));
  await expect(row).toBeVisible();

  // Personal info edit.
  await row.click();
  await page.getByTestId('tab-personal').click();
  await page.getByTestId('personal-form').locator('input[name="emergency_name"]').fill('أخوها');
  await page.getByTestId('personal-form').locator('button[type="submit"]').click();
  await expect(page.getByText('تم الحفظ').first()).toBeVisible();

  // Health tab (logged read) and allergy warning on the header.
  await page.getByTestId('tab-health').click();
  await page.locator('textarea[name="allergies"]').fill('بنسلين');
  await page.getByTestId('save-health').click();
  await expect(page.getByTestId('warn-allergies')).toContainText('بنسلين');

  // Activity shows the read.
  await page.getByTestId('tab-activity').click();
  await expect(page.getByTestId('activity-table')).toContainText('اطلاع');

  // Assign to reception; reception sees it in notifications.
  await page.getByTestId('more-actions').click();
  await page.getByTestId('assign').click();
  const assign = page.getByTestId('assign-form');
  await assign.getByRole('textbox', { name: 'إسناد إلى' }).click();
  await page.getByRole('option', { name: 'أمل الغامدي' }).click();
  await assign.locator('textarea').fill('اتصل لتأكيد البيانات');
  await assign.locator('button[type="submit"]').click();
  await page.getByTestId('tab-overview').click();
  await expect(page.getByTestId('open-assignments')).toContainText('اتصل لتأكيد البيانات');
});

test('Ctrl+K finds a patient by name', async ({ page }) => {
  await signIn(page, 'reception');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('اكتب أمراً أو ابحث…').fill('محمد العتيبي');
  const first = page.locator('.mantine-Spotlight-action').first();
  await expect(first).toContainText('محمد');
  await first.click();
  await expect(page.getByTestId('patient-header')).toBeVisible();
});

test('duplicate mobile is flagged', async ({ page }) => {
  await signIn(page, 'reception');
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill('محمد');
  const firstRow = page.getByTestId('patients-table').locator('tbody tr').first();
  const mobile = (await firstRow.locator('td').nth(2).innerText()).trim();
  await page.getByTestId('new-patient').click();
  await page.getByTestId('new-patient-form').locator('input[name="mobile"]').fill(mobile);
  await expect(page.getByTestId('duplicate-alert')).toBeVisible();
});
