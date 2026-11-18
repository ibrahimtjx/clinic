import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp } from '../test/render';
import type { Patient } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const PERMS = ['patient.view', 'patient.create', 'patient.edit', 'patient.medical_view', 'patient.assign'];

const row = (id: number, name_ar: string, name_en: string, mobile: string, balance = '0.00') => ({
  id, file_no: 1000 + id, name_ar, name_en, mobile, national_id: `10000000${id}0`.slice(0, 10), default_doctor_id: null,
  insurance_company_id: null, balance, last_visit_at: null, created_at: '2026-11-15T10:00:00+03:00', is_active: true,
});

const patient = (over: Partial<Patient> = {}): Patient => ({
  id: 7, file_no: 1007, secondary_file_no: null, name_ar: 'فاطمة علي الشمري', name_en: 'Fatimah Ali Alshammari',
  national_id: '1000000007', nationality: 'SA', gender: 'female', dob: '1990-01-15', mobile: '0551000007', phone: null,
  emergency_name: null, emergency_phone: null, default_doctor_id: null, is_external: false, sms_opt_out: false,
  chronic_diseases: 'سكري', allergies: 'بنسلين', referral_source_id: null, notes: '', balance: '350.00', last_visit_at: null,
  created_at: '2026-11-01T10:00:00+03:00', created_by: 1, is_active: true, version: 3, updated_at: '', deleted_at: null,
  insurance: { company_id: 1, policy_no: 'P1', class_name: 'A', membership_no: '', expiry: null, company_name_ar: 'التعاونية', company_name_en: 'Tawuniya' },
  ...over,
});

describe('patient list', () => {
  it('searches as you type and highlights Arabic matches across spelling variants', async () => {
    const api = fakeApi({
      me: makeMe({ permissions: PERMS }),
      routes: {
        'GET /api/patients': () => [200, { items: [row(1, 'فاطمة علي', 'Fatimah Ali', '0551000001', '120.00')], total: 1 }],
        'GET /api/doctors': () => [200, []],
        'GET /api/insurance-companies': () => [200, []],
      },
    });
    renderApp('/patients', 'en');
    const user = userEvent.setup();
    expect(await screen.findByTestId('patient-row-1001')).toHaveTextContent('SAR 120.00');
    await user.type(screen.getByTestId('patient-search'), 'فاطمه');
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/patients' && c.method === 'GET')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('patient-row-1001').querySelector('mark')).toHaveTextContent('فاطمة'));
    expect(screen.getByTestId('patients-total')).toHaveTextContent('1 patients');
  });

  it('warns about a duplicate and can register anyway', async () => {
    const api = fakeApi({
      me: makeMe({ permissions: PERMS }),
      routes: {
        'GET /api/patients': () => [200, { items: [], total: 0 }],
        'GET /api/doctors': () => [200, []],
        'GET /api/insurance-companies': () => [200, []],
        'GET /api/patients/duplicates': () => [200, [{ id: 7, file_no: 1007, name_ar: 'فاطمة', name_en: 'Fatimah', matched_on: ['mobile'] }]],
        'POST /api/patients': (b) =>
          (b as { allow_duplicate: boolean }).allow_duplicate
            ? [201, patient({ id: 9, file_no: 1009 })]
            : [409, { detail: { code: 'possible_duplicate', matches: [{ id: 7, file_no: 1007, name_ar: 'فاطمة', name_en: 'Fatimah', matched_on: ['mobile'] }] } }],
        'GET /api/patients/9': () => [200, patient({ id: 9, file_no: 1009 })],
        'GET /api/patients/9/assignments': () => [200, []],
      },
    });
    renderApp('/patients', 'en');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('new-patient'));
    const form = await screen.findByTestId('new-patient-form');
    await user.type(form.querySelector('input[name="name_ar"]')!, 'فاطمة أخرى');
    await user.type(form.querySelector('input[name="mobile"]')!, '0551000007');
    expect(await screen.findByTestId('duplicate-alert')).toHaveTextContent('File no. 1007');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Register a new patient anyway' }));
    expect(await screen.findByTestId('file-no')).toHaveTextContent('1009');
    expect(api.calls.filter((c) => c.path === '/api/patients' && c.method === 'POST')).toHaveLength(2);
  });
});

describe('patient profile', () => {
  it('shows the header card with age, warnings, insurance and balance; health opens the logged endpoint', async () => {
    const api = fakeApi({
      me: makeMe({ permissions: [...PERMS, 'audit.view'] }),
      routes: {
        'GET /api/patients/7': () => [200, patient()],
        'GET /api/patients/7/assignments': () => [200, []],
        'GET /api/doctors': () => [200, []],
        'GET /api/patients/7/health': () => [200, { chronic_diseases: 'سكري', allergies: 'بنسلين', medications: 'ميتفورمين', medical_history: '', version: 3 }],
      },
    });
    renderApp('/patients/7', 'en');
    expect(await screen.findByTestId('file-no')).toHaveTextContent('1007');
    expect(screen.getByTestId('age')).toHaveTextContent(/^\d+ y, \d+ m, \d+ d$/);
    expect(screen.getByTestId('warn-allergies')).toHaveTextContent('بنسلين');
    expect(screen.getByTestId('insurance-badge')).toHaveTextContent('Tawuniya');
    expect(screen.getByTestId('balance-badge')).toHaveTextContent('SAR 350.00');
    expect(api.calls.some((c) => c.path === '/api/patients/7/health')).toBe(false); // medical file not opened yet
    await userEvent.setup().click(screen.getByTestId('tab-health'));
    expect(await screen.findByDisplayValue('ميتفورمين')).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === '/api/patients/7/health')).toHaveLength(1);
  });

  it('hides the health tab without the medical permission', async () => {
    fakeApi({
      me: makeMe({ permissions: ['patient.view'] }),
      routes: { 'GET /api/patients/7': () => [200, patient()], 'GET /api/patients/7/assignments': () => [200, []], 'GET /api/doctors': () => [200, []] },
    });
    renderApp('/patients/7', 'en');
    await screen.findByTestId('file-no');
    expect(screen.queryByTestId('tab-health')).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-personal')).toBeInTheDocument();
  });
});
