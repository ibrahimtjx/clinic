import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp } from '../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const patient = { id: 7, file_no: 1007, name_ar: 'سارة', name_en: 'Sara', default_doctor_id: null, insurance: null, nationality: 'SA', national_id: '1012345678' };
const svc = { id: 3, number: 3, code: 'DN003', name_ar: 'كشف', name_en: 'Consultation', department_id: null, sale_price: '200.00', min_price: '150.00', max_price: '250.00', cost_price: '0.00', vat_applicable: true, is_consultation: true, is_active: true, sort_order: 0, version: 1, updated_at: '', deleted_at: null };

it('new quotation: picks a service and shows server-calculated totals; saves', async () => {
  const api = fakeApi({
    me: makeMe({ permissions: ['quotation.view', 'quotation.edit', 'patient.view'] }),
    routes: {
      'GET /api/patients/7': () => [200, patient],
      'GET /api/doctors': () => [200, []],
      'GET /api/services': () => [200, [svc]],
      'GET /api/insurance-classes': () => [200, []],
      'POST /api/pricing/preview': () => [200, {
        gross: '200.00', discount: '0.00', net: '200.00', vat: '0.00', total: '200.00', insurance_share: '0.00', patient_share: '200.00',
        insurance: null, saudi: true, notes: [],
        lines: [{ seq: 1, service_id: 3, description_ar: 'كشف', description_en: 'Consultation', price: '200.00', qty: '1.00', discount_amount: '0.00', discount_pct: '0.00', gross: '200.00', discount: '0.00', net: '200.00', vat_rate: '0.00', vat_amount: '0.00', line_total: '200.00', patient_share: '200.00', insurance_share: '0.00', teeth: [], price_overridden: false }],
      }],
      'POST /api/quotations': () => [201, { id: 11, quotation_no: 'Q-2026-000001', status: 'draft', patient_id: 7, doctor_id: null, lines: [], version: 1, gross: '200.00', discount: '0.00', net: '200.00', vat: '0.00', total: '200.00', insurance_share: '0.00', patient_share: '200.00', insurance: null, saudi: true, notes: '', created_at: '2026-11-15T10:00:00+03:00', updated_at: '', created_by: 1, created_by_name: 'x', patient_name_ar: 'سارة', patient_name_en: 'Sara', patient_file_no: 1007, plan_id: null, clinic_id: null, valid_until: '2026-12-15' }],
      'GET /api/quotations/11': () => [200, { id: 11, quotation_no: 'Q-2026-000001', status: 'draft', patient_id: 7, doctor_id: null, lines: [], version: 1, gross: '200.00', discount: '0.00', net: '200.00', vat: '0.00', total: '200.00', insurance_share: '0.00', patient_share: '200.00', insurance: null, saudi: true, notes: '', created_at: '2026-11-15T10:00:00+03:00', updated_at: '', created_by: 1, created_by_name: 'x', patient_name_ar: 'سارة', patient_name_en: 'Sara', patient_file_no: 1007, plan_id: null, clinic_id: null, valid_until: '2026-12-15' }],
    },
  });
  renderApp('/billing/quotation/new?patient=7', 'en');
  const user = userEvent.setup();
  await screen.findByTestId('document-editor');
  await user.type(screen.getByTestId('line-service-0'), 'DN003');
  await user.click(await screen.findByRole('option', { name: /DN003/, hidden: true }));
  await waitFor(() => expect(screen.getByTestId('patient-due')).toHaveTextContent('SAR 200.00'));
  expect(screen.getByText('Saudi citizen: exempt from VAT.')).toBeInTheDocument();
  const preview = api.calls.find((c) => c.path === '/api/pricing/preview');
  expect((preview!.body as { lines: { service_id: number; price: string }[] }).lines[0]).toMatchObject({ service_id: 3, price: '200.00' });
  await user.click(screen.getByTestId('save-draft'));
  await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/quotations')).toBe(true));
  expect(await screen.findByTestId('doc-number')).toHaveTextContent('Q-2026-000001');
  // Totals in the request are never sent: only what the user chose.
  const post = api.calls.find((c) => c.method === 'POST' && c.path === '/api/quotations');
  expect(post!.body).not.toHaveProperty('total');
  expect(within(screen.getByTestId('summary')).getByText('SAR 200.00', { selector: '[data-testid="patient-due"]' })).toBeInTheDocument();
});
