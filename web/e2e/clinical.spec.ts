import { expect, test } from '@playwright/test';
import path from 'node:path';

import { ownPatient, signIn } from './helpers';

test('doctor uploads an X-ray, writes and prints a prescription, requests a lab test and enters the result', async ({ page, baseURL }) => {
  const pt = await ownPatient(baseURL, 'dr.reem', `نورة سريرية ${Date.now() % 100000}`);
  await signIn(page, 'dr.reem');
  await page.goto('/patients');
  await page.getByTestId('patient-search').fill(pt.name_ar);
  const row = page.getByTestId('patients-table').locator('tbody tr').first();
  await expect(row.locator('mark').first()).toBeVisible();
  await row.click();

  // Images and documents.
  await page.getByTestId('tab-files').click();
  await page.getByTestId('upload-files').click();
  await page.locator('input[type="file"]').setInputFiles(path.resolve('e2e/fixtures-xray.png'));
  await page.getByTestId('confirm-upload').click();
  const card = page.getByTestId('files-grid').locator('[data-testid^="file-"]').first();
  await expect(card.locator('img')).toBeVisible();
  await card.locator('img').click();
  await expect(page.getByTestId('file-viewer').locator('img')).toBeVisible();
  await page.keyboard.press('Escape');

  // Prescription.
  await page.getByTestId('tab-prescriptions').click();
  await page.getByTestId('new-prescription').click();
  await page.getByTestId('rx-drug-0').fill('Amoxicillin 500');
  await page.getByRole('option', { name: 'Amoxicillin 500 mg' }).click();
  await page.getByTestId('save-rx').click();
  const rx = page.locator('[data-testid^="rx-"]').filter({ hasText: 'Amoxicillin 500 mg' }).first();
  await expect(rx).toContainText('Every 8 hours');
  const popup = page.waitForEvent('popup');
  await rx.getByTestId('clinical-print').click();
  const print = await popup;
  await expect(print.getByTestId('rx-print')).toContainText('Amoxicillin 500 mg');
  await expect(print.getByTestId('rx-print')).toContainText('Signature');
  await print.close();

  // Lab request and result.
  await page.getByText(/^(المختبر|Lab)$/).click();
  await page.getByTestId('new-lab').click();
  await page.getByTestId('lab-tests').click();
  await page.getByRole('option', { name: /HBA1C/ }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('save-lab').click();
  // The new request is the one still waiting for results (earlier runs' requests have results).
  const fresh = page.locator('[data-testid^="lab-"]').filter({ hasText: /سارية|Active/ }).first();
  await expect(fresh).toContainText('HbA1c');
  const lab = page.getByTestId((await fresh.getAttribute('data-testid'))!); // follow this card by its id
  await lab.getByTestId('enter-results').click();
  await page.getByTestId('result-0').fill('7.1');
  await page.getByTestId('save-results').click();
  await expect(lab).toContainText('7.1');
  await expect(lab).toContainText(/وصلت النتائج|Results in/);
});
