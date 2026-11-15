import { expect, type Page } from '@playwright/test';

// Users created by `python -m app.cli seed-dev` (fake development data).
export const DEV_PASSWORD = 'Clinic-dev-2026';
export const DEV_PIN = '2468';

export async function signIn(page: Page, username = 'admin', password = DEV_PASSWORD) {
  await page.goto('/');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('[data-testid="login-form"] button[type="submit"]').click();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
}
