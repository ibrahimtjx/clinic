import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp } from '../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const catalog = [{ key: 'revenue', title_ar: 'تقرير الإيرادات', title_en: 'Revenue report', group: 'financial', filters: ['date_range', 'method'], description_ar: '', description_en: '' }];
const result = {
  key: 'revenue', title_ar: 'تقرير الإيرادات', title_en: 'Revenue report', period: '01/11/2026 – 16/11/2026', patient: null, generated_at: '2026-11-16T09:00:00+03:00',
  sections: [{
    key: 'detail', title_ar: 'المقبوضات', title_en: 'Receipts',
    columns: [
      { key: 'receipt_no', ar: 'رقم السند', en: 'Receipt no.', type: 'text' },
      { key: 'kind_ar', ar: 'النوع', en: 'Type', type: 'text' },
      { key: 'at', ar: 'التاريخ', en: 'Date and time', type: 'datetime' },
      { key: 'amount', ar: 'المبلغ', en: 'Amount paid', type: 'money' },
    ],
    rows: [{ receipt_no: 'RC-2026-000001', kind_ar: 'سداد', kind_en: 'Payment', at: '2026-11-15T10:30:00+03:00', amount: '1380.00' }],
    totals: { amount: '1380.00' },
  }],
  summary: [{ ar: 'عدد الفواتير', en: 'Invoice count', type: 'int', value: 2 }],
  notes_ar: [], notes_en: ['Receipts by receipt date.'],
};

it('runs a report with this month by default, shows English text and totals, exports Excel', async () => {
  const api = fakeApi({
    me: makeMe({ permissions: ['report.revenue'] }),
    routes: {
      'GET /api/reports': () => [200, catalog],
      'GET /api/reports/options': () => [200, { users: [], doctors: [], clinics: [], companies: [] }],
      'GET /api/reports/revenue': () => [200, result],
    },
  });
  renderApp('/reports/revenue', 'en');
  const table = await screen.findByTestId('section-detail');
  expect(within(table).getByText('Payment')).toBeInTheDocument(); // English twin of kind_ar
  expect(within(table).getByText('15/11/2026 10:30 AM')).toBeInTheDocument();
  expect(within(table).getAllByText('SAR 1,380.00')).toHaveLength(2); // row + total
  expect(screen.getByTestId('report-summary')).toHaveTextContent('Invoice count2');
  const run = api.calls.find((c) => c.path === '/api/reports/revenue');
  expect(run!.query).toMatchObject({ date_from: expect.stringMatching(/-01$/), date_to: expect.any(String) });

  const created: string[] = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    created.push(this.download);
  });
  api.on('GET /api/reports/revenue/excel', () => [200, 'xlsx', { 'Content-Disposition': "attachment; filename*=UTF-8''revenue-report-20261116.xlsx" }]);
  await userEvent.setup().click(screen.getByTestId('report-excel'));
  await waitFor(() => expect(created).toEqual(['revenue-report-20261116.xlsx']));
  expect(api.calls.find((c) => c.path === '/api/reports/revenue/excel')!.query).toMatchObject({ lang: 'en' });
  click.mockRestore();
});
