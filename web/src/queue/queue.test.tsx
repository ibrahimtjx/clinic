import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp } from '../test/render';
import type { QueueEntry } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const entry = (no: number, stage: QueueEntry['stage'], waited: number): QueueEntry => ({
  id: no, day: '2026-11-15', queue_no: no, patient_id: no, doctor_id: 1, clinic_id: null, appointment_id: null,
  received_at: '2026-11-15T09:00:00+03:00', received_by: 1, called_at: null, called_by: null, entered_at: stage === 'with_doctor' ? '2026-11-15T09:20:00+03:00' : null,
  entered_by: null, exited_at: null, exited_by: null, postponed: false, note: '', cancelled_at: null, version: 1, stage, waited_minutes: waited,
  patient_name_ar: `مريض ${no}`, patient_name_en: `Patient ${no}`, patient_file_no: 100 + no, visit_type_id: null, user_names: {},
});

it('shows the board columns with wait colors and calls a patient', async () => {
  const api = fakeApi({
    me: makeMe({ permissions: ['queue.view', 'queue.manage', 'patient.view'] }),
    routes: {
      'GET /api/doctors': () => [200, []],
      'GET /api/visit-types': () => [200, []],
      'GET /api/settings/queue': () => [200, { warn_minutes: 15, late_minutes: 30 }],
      'GET /api/queue': () => [200, [entry(1, 'waiting', 35), entry(2, 'waiting', 5), entry(3, 'with_doctor', 20)]],
      'POST /api/queue/1/call': () => [200, entry(1, 'called', 35)],
    },
  });
  localStorage.setItem('clinic.queueView', JSON.stringify('board'));
  renderApp('/queue', 'en');
  const waiting = await screen.findByTestId('queue-col-waiting');
  const late = within(waiting).getByTestId('queue-card-1');
  expect(within(late).getByTestId('waited')).toHaveTextContent('35 min');
  expect(within(late).getByTestId('waited').className).toMatch(/Badge/);
  expect(within(screen.getByTestId('queue-col-with_doctor')).getByTestId('queue-card-3')).toBeInTheDocument();
  await userEvent.setup().click(within(late).getByTestId('q-call'));
  expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/queue/1/call')).toBe(true);
});
