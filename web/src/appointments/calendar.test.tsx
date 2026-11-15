import { fireEvent, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp } from '../test/render';
import { layoutLanes } from './CalendarGrid';
import type { Appointment } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const appt = (id: number, s: string, e: string, over: Partial<Appointment> = {}): Appointment => ({
  id, patient_id: 1, doctor_id: 1, clinic_id: null, starts_at: `2027-01-03T${s}:00+03:00`, ends_at: `2027-01-03T${e}:00+03:00`,
  status_id: 1, blocks_slot: true, visit_type_id: null, service_id: null, is_waiting_list: false, note: '', exclude_sms: false,
  confirmed_by: null, confirmed_at: null, cancel_reason: null, created_by: 1, created_at: '2027-01-01T10:00:00+03:00', updated_at: '2027-01-01T10:00:00+03:00', version: 1, deleted_at: null,
  patient: { id: 1, file_no: 77, name_ar: 'سارة', name_en: 'Sara', mobile: '0551111111', is_insured: true, has_balance: false, is_new: true, appointment_count: 1 },
  created_by_name: 'أمل', confirmed_by_name: null, ...over,
});

describe('layoutLanes', () => {
  it('puts overlapping cards side by side and keeps separate ones full width', () => {
    const lanes = layoutLanes([appt(1, '09:00', '09:30'), appt(2, '09:15', '09:45'), appt(3, '10:00', '10:15')]);
    expect(lanes.get(1)).toEqual({ index: 0, count: 2 });
    expect(lanes.get(2)).toEqual({ index: 1, count: 2 });
    expect(lanes.get(3)).toEqual({ index: 0, count: 1 });
  });
});

const doctor = (id: number, name: string) => ({
  id, user_id: null, name_ar: name, name_en: name, specialty_ar: '', specialty_en: '', clinic_id: null, department_id: null, color: 'blue',
  slot_minutes: 15, is_active: true, sort_order: id, version: 1, updated_at: '', deleted_at: null, commission_rules: null,
  schedules: [0, 1, 2, 3, 4].map((d) => ({ weekday: d, start_time: '09:00:00', end_time: '13:00:00', kind: 'work' })),
});

describe('calendar day view', () => {
  it('shows a column per doctor with the booked card, and a click on an empty slot opens a prefilled drawer', async () => {
    localStorage.setItem('clinic.calendarView', JSON.stringify('day'));
    fakeApi({
      me: makeMe({ permissions: ['appointment.view', 'appointment.create', 'appointment.edit', 'patient.view'] }),
      routes: {
        'GET /api/doctors': () => [200, [doctor(1, 'د. ريم'), doctor(2, 'د. عمر')]],
        'GET /api/appointment-statuses': () => [200, [{ id: 1, key: 'unconfirmed', name_ar: 'غير مؤكد', name_en: 'Unconfirmed', color: 'neutral', blocks_slot: true, is_system: true, is_active: true, sort_order: 10, version: 1, updated_at: '', deleted_at: null }]],
        'GET /api/visit-types': () => [200, []],
        'GET /api/services': () => [200, []],
        'GET /api/appointments': () => [200, [appt(5, '09:30', '10:00')]],
        'GET /api/waiting-list': () => [200, []],
        'GET /api/saved-phrases': () => [200, []],
      },
    });
    renderApp('/appointments?date=2027-01-03', 'en');
    const card = await screen.findByTestId('appt-5');
    expect(card).toHaveTextContent('Sara');
    const col1 = screen.getByTestId('col-1-2027-01-03');
    expect(within(col1).getByTestId('appt-5')).toBeInTheDocument();
    const col2 = screen.getByTestId('col-2-2027-01-03');
    // jsdom has no layout: getBoundingClientRect().top is 0, so clientY maps directly to minutes.
    const startMin = 8 * 60;
    fireEvent.click(col2, { clientY: (10 * 60 + 7 - startMin) * 1.6 });
    const form = await screen.findByTestId('appointment-form');
    expect(within(form).getByTestId('appt-start')).toHaveValue('10:00');
    expect(within(form).getByTestId('appt-doctor')).toHaveValue('د. عمر');
  });
});
