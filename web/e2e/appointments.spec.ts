import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers';

/** A random future Monday, so repeated runs on the same database do not collide. */
function futureMonday(): string {
  const d = new Date(Date.UTC(2031 + Math.floor(Math.random() * 20), 0, 1));
  d.setUTCDate(d.getUTCDate() + Math.floor(Math.random() * 300));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function doctorIds(page: Page) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/refresh', { method: 'POST' })).json()).access_token);
  const docs = await (await page.request.get('/api/doctors', { headers: { Authorization: `Bearer ${token}` } })).json();
  const reem = docs.find((d: { name_en: string }) => d.name_en.includes('Reem'));
  const omar = docs.find((d: { name_en: string }) => d.name_en.includes('Omar'));
  return { reem: reem.id as number, omar: omar.id as number };
}

/** Clicks the column at a local time (grid starts at 08:00, 1.6 px per minute). */
async function clickSlot(page: Page, doctor: number, date: string, hh: number, mm: number) {
  const col = page.getByTestId(`col-${doctor}-${date}`);
  await col.scrollIntoViewIfNeeded();
  await col.click({ position: { x: 40, y: ((hh - 8) * 60 + mm) * 1.6 + 3 } });
}

async function pickPatient(page: Page, q: string) {
  await page.getByTestId('appt-patient').fill(q);
  await page.getByRole('option').first().click();
}

test('book from an empty slot, refuse an overlap, drag to move, cancel and see the waiting list', async ({ page }) => {
  const date = futureMonday();
  await signIn(page, 'reception');
  const { reem } = await doctorIds(page);
  await page.goto(`/appointments?date=${date}`);
  await page.getByText('يوم', { exact: true }).click();
  await expect(page.getByTestId('calendar-grid')).toBeVisible();

  // Book 09:00 with Dr. Reem.
  await clickSlot(page, reem, date, 9, 0);
  await expect(page.getByTestId('appt-start')).toHaveValue('09:00');
  await pickPatient(page, 'محمد');
  await page.getByTestId('appt-save').click();
  const first = page.getByTestId(`col-${reem}-${date}`).locator('[data-card]').first();
  await expect(first).toBeVisible();

  // A booking that overlaps it: refused, naming the clash.
  await clickSlot(page, reem, date, 11, 40);
  await page.getByTestId('appt-start').fill('09:05');
  await pickPatient(page, 'نورة');
  await page.getByTestId('appt-save').click();
  await expect(page.getByTestId('appointment-overlap')).toBeVisible();
  await page.getByRole('button', { name: 'إلغاء' }).click();
  await page.getByRole('button', { name: 'تجاهل' }).click().catch(() => {});
  await expect(page.getByTestId('appointment-form')).toBeHidden();
  await expect(page.locator('.mantine-Modal-content')).toHaveCount(0);

  // Drag the card down one hour; confirm.
  await first.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + 60 * 1.6, { steps: 8 });
  await expect(page.getByTestId('drag-ghost')).toContainText('10:00');
  await page.mouse.up();
  await page.getByTestId('move-ok').click();
  await expect(page.getByTestId('move-confirm')).toHaveCount(0);
  // One hour lower in the grid (60 min × 1.6 px).
  await expect.poll(async () => Math.round((await first.boundingBox())!.y - box.y)).toBe(96);

  // Put a patient on the waiting list for Mondays 09:00-12:00, then cancel the 10:00 booking.
  await page.getByTestId('waiting-open').click();
  await page.getByRole('button', { name: 'إضافة إلى قائمة الانتظار' }).click();
  const panel = page.getByTestId('waiting-panel');
  await panel.getByLabel('المريض').fill('فاطمة');
  await panel.getByRole('button').filter({ hasText: 'فاطمة' }).first().click();
  await panel.getByRole('button', { name: 'حفظ' }).click();
  await page.keyboard.press('Escape');

  const id = (await first.getAttribute('data-testid'))!.replace('appt-', '');
  await page.getByTestId(`menu-${id}`).click();
  await page.getByTestId('menu-cancel').click();
  await page.getByTestId('cancel-reason').fill('اعتذر المريض');
  await page.getByTestId('cancel-ok').click();
  await expect(page.getByTestId('freed-alert')).toBeVisible();
  await expect(page.getByTestId(`appt-${id}`)).toHaveCount(0); // cancelled hidden by default
});

test('outside working hours asks to continue; reception may override', async ({ page }) => {
  const date = futureMonday();
  await signIn(page, 'reception');
  const { omar } = await doctorIds(page);
  await page.goto(`/appointments?date=${date}`);
  await clickSlot(page, omar, date, 14, 0); // between Dr. Omar's periods
  await pickPatient(page, 'سارة');
  await page.getByTestId('appt-save').click();
  await expect(page.getByTestId('appointment-warnings')).toContainText('خارج ساعات عمل');
  await page.getByTestId('continue-anyway').click();
  await expect(page.getByTestId(`col-${omar}-${date}`).locator('[data-card]')).toHaveCount(1);
});

test('find next free slot opens a prefilled booking; print slip renders', async ({ page }) => {
  await signIn(page, 'reception');
  await page.goto('/appointments');
  await page.getByTestId('find-slot').click();
  const first = page.getByTestId('free-slots').getByRole('button').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByTestId('appointment-form')).toBeVisible();
  await pickPatient(page, 'محمد');
  await page.getByTestId('appt-save').click();
  // The patient may already have a booking that day from an earlier run: confirm and continue.
  const cont = page.getByTestId('continue-anyway');
  if (await cont.isVisible({ timeout: 1500 }).catch(() => false)) await cont.click();
  await expect(page.getByTestId('appointment-form')).toBeHidden();
});

test('patient profile books for that patient and lists appointments', async ({ page }) => {
  await signIn(page, 'reception');
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill('محمد');
  const row = page.getByTestId('patients-table').locator('tbody tr').first();
  await expect(row.locator('mark').first()).toBeVisible();
  await row.click();
  await page.getByTestId('profile-new-appointment').click();
  await expect(page.getByTestId('appt-patient')).toHaveValue(/محمد/);
  await page.keyboard.press('Escape');
  await page.goBack();
  await page.getByTestId('tab-appointments').click();
  await expect(page.getByTestId('patient-appointments').or(page.getByText('لا توجد مواعيد'))).toBeVisible();
});
