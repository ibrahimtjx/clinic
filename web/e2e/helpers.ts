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

/** A new patient whose usual doctor is `doctorUser`'s doctor (doctors see only their own patients). */
export async function ownPatient(baseURL: string | undefined, doctorUser: string, name: string): Promise<{ id: number; name_ar: string }> {
  const { request } = await import('@playwright/test');
  const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const token = async (u: string) => (await (await api.post('/api/auth/login', { data: { username: u, password: DEV_PASSWORD } })).json()).access_token as string;
  const desk = { Authorization: `Bearer ${await token('reception')}` };
  const dr = { Authorization: `Bearer ${await token(doctorUser)}` };
  const me = await (await api.get('/api/auth/me', { headers: dr })).json();
  const doc = (await (await api.get('/api/doctors', { headers: desk })).json()).find((d: { user_id: number | null }) => d.user_id === me.id);
  const pt = await (await api.post('/api/patients', { headers: desk, data: { name_ar: name, allow_duplicate: true, default_doctor_id: doc.id } })).json();
  await api.dispose();
  return pt;
}
