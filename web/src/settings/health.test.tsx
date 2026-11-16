import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp } from '../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const warning = { code: 'backup_old', severity: 'danger', params: { node: 'server-1', at: '2026-11-14T02:00:00+03:00' } };

it('admins see a server warning banner with a link to the health page', async () => {
  fakeApi({
    me: makeMe({ permissions: ['settings.manage'] }),
    routes: { 'GET /api/system/warnings': () => [200, { warnings: [warning] }] },
  });
  renderApp('/', 'en');
  const banner = await screen.findByTestId('health-banner');
  expect(banner).toHaveTextContent('The last nightly backup on server-1 was 14/11/2026 02:00 AM: more than 26 hours ago.');
  expect(screen.getByRole('link', { name: 'Open the system health page' })).toHaveAttribute('href', '/settings/system-health');
});

it('other users never ask for server warnings', async () => {
  const api = fakeApi({ me: makeMe({ permissions: ['patient.view'] }) });
  renderApp('/', 'en');
  await screen.findByTestId('server-time');
  expect(api.calls.some((c) => c.path === '/api/system/warnings')).toBe(false);
  expect(screen.queryByTestId('health-banner')).not.toBeInTheDocument();
});
