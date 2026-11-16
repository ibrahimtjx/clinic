import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp } from '../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('app shell', () => {
  it('renders Arabic RTL by default with the sidebar items', async () => {
    fakeApi();
    renderApp('/');
    const time = await screen.findByTestId('server-time');
    await waitFor(() => expect(time).toHaveTextContent('15/11/2026 04:05 م'));
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(screen.getAllByText('المواعيد').length).toBeGreaterThan(0);
  });

  it('renders English LTR when chosen', async () => {
    fakeApi();
    renderApp('/', 'en');
    await screen.findByTestId('server-time');
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
    expect(screen.getAllByText('Appointments').length).toBeGreaterThan(0);
  });

  it('shows the offline banner and disables actions when the server is unreachable', async () => {
    const api = fakeApi();
    api.on('GET /api/health', () => Promise.reject(new TypeError('network')));
    renderApp('/', 'en');
    expect(await screen.findByTestId('offline-banner')).toBeInTheDocument();
    expect(screen.getByTestId('new-appointment')).toBeDisabled();
  });

  it.each(['ar', 'en'] as const)('renders the design page in %s', async (lang) => {
    fakeApi();
    renderApp('/design', lang);
    expect(await screen.findByTestId('design-page')).toBeInTheDocument();
    expect(screen.getByTestId('sample-money')).toHaveTextContent(lang === 'ar' ? '12,450.50 ر.س' : 'SAR 12,450.50');
  });

  it('reports page lists the reports the user may run', async () => {
    fakeApi({
      me: makeMe({ permissions: ['report.revenue'] }),
      routes: { 'GET /api/reports': () => [200, [{ key: 'revenue', title_ar: 'تقرير الإيرادات', title_en: 'Revenue report', group: 'financial', filters: ['date_range'], description_ar: '', description_en: 'Money received' }]] },
    });
    renderApp('/reports', 'en');
    expect(await screen.findByTestId('report-revenue')).toHaveTextContent('Revenue report');
  });

  it('shows sidebar items by permission', async () => {
    fakeApi({ me: makeMe({ permissions: ['report.clinical', 'dental.view'] }) });
    renderApp('/', 'en');
    await screen.findByTestId('server-time');
    expect(screen.getAllByText('Reports').length).toBeGreaterThan(0);
    expect(screen.queryByText('Appointments')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
});
