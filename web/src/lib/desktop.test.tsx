import { waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { fakeApi } from '../test/fakeApi';
import { renderApp } from '../test/render';
import { printDoc, printKind } from './print';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { __TAURI__?: unknown }).__TAURI__;
});

function stubDesktop(impl: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => impl(cmd, args));
  (window as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
  return invoke;
}

it('picks the receipt printer for receipts and slips, A4 otherwise', () => {
  expect(printKind('/print/receipt/3')).toBe('receipt');
  expect(printKind('/print/slip/9')).toBe('receipt');
  expect(printKind('/print/test/receipt')).toBe('receipt');
  expect(printKind('/print/invoice/3')).toBe('a4');
  expect(printKind('/print/report/revenue?date_from=2026-11-01')).toBe('a4');
});

it('desktop: prints silently; browser: opens the preview', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  await printDoc('/print/invoice/5');
  expect(open).toHaveBeenCalledWith('/print/invoice/5', '_blank', 'noopener');
  open.mockClear();
  const invoke = stubDesktop(() => undefined);
  await printDoc('/print/receipt/7');
  expect(invoke).toHaveBeenCalledWith('print_url', { url: `${window.location.origin}/print/receipt/7`, kind: 'receipt' });
  expect(open).not.toHaveBeenCalled();
  // A failure falls back to the preview so the user can still print.
  invoke.mockRejectedValueOnce('print_timeout');
  await printDoc('/print/invoice/5');
  expect(open).toHaveBeenCalledWith('/print/invoice/5', '_blank', 'noopener');
  open.mockRestore();
});

it('a print page opened by the desktop app for a job signals ready instead of the dialog', async () => {
  fakeApi({ routes: { 'GET /api/settings/clinic': () => [200, { name_ar: 'عيادة', name_en: 'Clinic', phone: '' }] } });
  const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  const invoke = stubDesktop(() => undefined);
  renderApp('/print/test/receipt?job=print-1', 'ar');
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('print_ready', { job: 'print-1' }));
  expect(print).not.toHaveBeenCalled();
  print.mockRestore();
});
