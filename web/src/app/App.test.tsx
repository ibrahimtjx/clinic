import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { renderApp } from '../test/render';

const health = { status: 'ok', version: '0.1.0', database: 'ok', server_time: '2026-11-15T16:05:00+03:00', timezone: 'Asia/Riyadh' };

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stubFetch(ok: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (ok ? new Response(JSON.stringify(health), { status: 200 }) : Promise.reject(new TypeError('network')))),
  );
}

describe('app shell', () => {
  it('renders Arabic RTL by default with the sidebar items', async () => {
    stubFetch(true);
    renderApp('/');
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar');
    expect(screen.getAllByText('المواعيد').length).toBeGreaterThan(0);
    expect(await screen.findByTestId('server-time')).toHaveTextContent('15/11/2026 04:05 م');
  });

  it('renders English LTR when chosen', async () => {
    stubFetch(true);
    renderApp('/', 'en');
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
    expect(screen.getAllByText('Appointments').length).toBeGreaterThan(0);
  });

  it('shows the offline banner and disables actions when the server is unreachable', async () => {
    stubFetch(false);
    renderApp('/', 'en');
    expect(await screen.findByTestId('offline-banner')).toBeInTheDocument();
    expect(screen.getByTestId('new-appointment')).toBeDisabled();
  });

  it.each(['ar', 'en'] as const)('renders the design page in %s', async (lang) => {
    stubFetch(true);
    renderApp('/design', lang);
    expect(await screen.findByTestId('design-page')).toBeInTheDocument();
    expect(screen.getByTestId('sample-money')).toHaveTextContent(lang === 'ar' ? '12,450.50 ر.س' : 'SAR 12,450.50');
  });

  it('shows a placeholder for modules not built yet', async () => {
    stubFetch(true);
    renderApp('/patients', 'en');
    expect(await screen.findByText(/milestone M3/)).toBeInTheDocument();
  });
});
