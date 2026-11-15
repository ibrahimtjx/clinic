import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import type { ScheduleItem } from '../master/types';
import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp, renderWithProviders } from '../test/render';
import { ScheduleEditor } from './DoctorsTab';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function Harness({ initial, onValue }: { initial: ScheduleItem[]; onValue: (v: ScheduleItem[]) => void }) {
  const [v, setV] = useState(initial);
  return (
    <ScheduleEditor
      value={v}
      onChange={(n) => {
        setV(n);
        onValue(n);
      }}
    />
  );
}

describe('schedule editor', () => {
  it('switches a day on with a default period and copies a day to the other working days', async () => {
    localStorage.setItem('clinic.lang', JSON.stringify('en'));
    let last: ScheduleItem[] = [];
    renderWithProviders(
      <Harness
        initial={[
          { weekday: 1, start_time: '08:00', end_time: '12:00', kind: 'work' },
          { weekday: 1, start_time: '10:00', end_time: '10:15', kind: 'break' },
        ]}
        onValue={(v) => (last = v)}
      />,
    );
    fireEvent.click(screen.getByTestId('day-0'));
    expect(last.filter((s) => s.weekday === 0)).toEqual([{ weekday: 0, start_time: '09:00', end_time: '13:00', kind: 'work' }]);
    fireEvent.click(screen.getAllByText('Copy to other days')[1]); // Monday's button
    expect(last.filter((s) => s.weekday === 0)).toEqual([
      { weekday: 0, start_time: '08:00', end_time: '12:00', kind: 'work' },
      { weekday: 0, start_time: '10:00', end_time: '10:15', kind: 'break' },
    ]);
    expect(last.some((s) => s.weekday === 5)).toBe(false); // days that are off stay off
  });
});

describe('settings sections', () => {
  it('shows only the sections the user may open', async () => {
    fakeApi({ me: makeMe({ permissions: ['audit.view'] }), routes: { 'GET /api/audit': () => [200, { items: [], next_cursor: null }] } });
    renderApp('/settings', 'en');
    expect(await screen.findByTestId('settings-nav-audit')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-nav-services')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No entries')).toBeInTheDocument());
  });

  it('lists services with prices and flags unpriced starting services', async () => {
    const svc = (id: number, code: string, price: string, active: boolean) => ({
      id, number: id, code, name_ar: `خدمة ${id}`, name_en: `Service ${id}`, department_id: null,
      sale_price: price, min_price: '0.00', max_price: price, cost_price: '0.00', vat_applicable: true,
      is_active: active, sort_order: 0, version: 1, updated_at: '', deleted_at: null,
    });
    fakeApi({
      me: makeMe({ permissions: ['settings.manage'] }),
      routes: {
        'GET /api/services': () => [200, [svc(1, 'DN001', '150.00', true), svc(2, 'DN002', '0.00', false)]],
        'GET /api/departments': () => [200, []],
        'GET /api/settings/clinic': () => [200, { name_ar: 'مجمع النخبة', name_en: 'Elite Complex' }],
      },
    });
    renderApp('/settings/services', 'en');
    expect(await screen.findByTestId('service-DN001')).toHaveTextContent('SAR 150.00');
    expect(screen.getByTestId('unpriced-alert')).toHaveTextContent('1 services');
    expect(screen.getByTestId('clinic-name')).toHaveTextContent('Elite Complex');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search by code or name'), 'DN002');
    expect(screen.queryByTestId('service-DN001')).not.toBeInTheDocument();
  });
});
