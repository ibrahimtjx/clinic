import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { fromCents, subMoney, sumMoney, toCents } from '../lib/money';
import { fakeApi, makeMe } from '../test/fakeApi';
import { renderApp } from '../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('money helpers add and subtract exactly in halalas', () => {
  expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
  expect(subMoney('126.50', '100')).toBe('26.50');
  expect(subMoney('10', '10.01')).toBe('-0.01');
  expect(toCents('1,234.5')).toBe(123450);
  expect(fromCents(5)).toBe('0.05');
});

const order = {
  id: 21, order_no: 'PO-2026-000021', status: 'sent', patient_id: 7, doctor_id: null, clinic_id: null, plan_id: null, notes: '', insurance: null, saudi: false,
  gross: '1200.00', discount: '0.00', net: '1200.00', vat: '180.00', total: '1380.00', insurance_share: '0.00', patient_share: '1380.00',
  created_at: '2026-11-15T10:00:00+03:00', created_by: 1, updated_at: '', version: 2, lines: [], patient_name_ar: 'جون', patient_name_en: 'John', patient_file_no: 1007,
  created_by_name: 'د. ريم', reception_note: 'بعد الجلسة', sent_at: '2026-11-15T10:05:00+03:00', sent_by_name: 'د. ريم', quotation_id: null, installment_id: null,
};

it('reception collects a split payment; the remainder goes to the balance', async () => {
  const api = fakeApi({
    me: makeMe({ permissions: ['payment.collect', 'invoice.view', 'quotation.view'] }),
    routes: {
      'GET /api/payment-orders': () => [200, [order]],
      'GET /api/doctors': () => [200, []],
      'GET /api/patients/7/account': () => [200, { patient_id: 7, balance: '0.00', deposit_balance: '200.00', unpaid: [], receipts: [] }],
      'POST /api/payment-orders/21/collect': () => [201, {
        invoice: { id: 5, invoice_no: 'INV-2026-000005', outstanding: '380.00', lines: [] },
        receipt: { id: 9, receipt_no: 'RC-2026-000009', total: '1000.00', balance_after: '380.00' },
      }],
    },
  });
  renderApp('/billing/inbox', 'en');
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('collect-21'));
  expect(await screen.findByTestId('collect-due')).toHaveTextContent('SAR 1,380.00');
  expect(await screen.findByText('On account: SAR 200.00')).toBeInTheDocument();
  const amount = screen.getByTestId('amount-0');
  await user.clear(amount);
  await user.type(amount, '800');
  await user.click(screen.getByTestId('add-method'));
  expect(screen.getByTestId('amount-1')).toHaveValue('580.00'); // prefilled with what is left
  await user.clear(screen.getByTestId('amount-1'));
  await user.type(screen.getByTestId('amount-1'), '200');
  expect(screen.getByTestId('to-balance')).toHaveTextContent('SAR 380.00 goes to the patient');
  await user.click(screen.getByTestId('confirm-collect'));
  expect(await screen.findByTestId('issued-invoice-no')).toHaveTextContent('INV-2026-000005');
  const call = api.calls.find((c) => c.path === '/api/payment-orders/21/collect');
  expect(call!.body).toEqual({
    version: 2,
    expected_patient_share: '1380.00',
    note: '',
    payments: [
      { method: 'cash', amount: '800.00', reference: '' },
      { method: 'mada', amount: '200.00', reference: '' },
    ],
  });
  expect(screen.getByText('Still owed by the patient: SAR 380.00')).toBeInTheDocument();
});

it('when amounts changed on the server, shows the new due and does not take money', async () => {
  fakeApi({
    me: makeMe({ permissions: ['payment.collect'] }),
    routes: {
      'GET /api/payment-orders': () => [200, [order]],
      'GET /api/doctors': () => [200, []],
      'GET /api/patients/7/account': () => [200, { patient_id: 7, balance: '0.00', deposit_balance: '0.00', unpaid: [], receipts: [] }],
      'POST /api/payment-orders/21/collect': () => [409, { detail: { code: 'totals_changed', patient_share: '1500.00' } }],
      'GET /api/payment-orders/21': () => [200, { ...order, version: 3, patient_share: '1500.00', total: '1500.00' }],
    },
  });
  renderApp('/billing/inbox', 'en');
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('collect-21'));
  await user.click(await screen.findByTestId('confirm-collect'));
  expect(await screen.findByTestId('totals-changed')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('collect-due')).toHaveTextContent('SAR 1,500.00'));
});
