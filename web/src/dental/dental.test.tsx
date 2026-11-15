import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';

import { renderWithProviders } from '../test/render';
import { ToothChart, type Dentition } from './ToothChart';
import type { Finding } from './types';

afterEach(() => localStorage.clear());

function Harness({ findings = [] as Finding[], onSel = vi.fn() }) {
  const [sel, setSel] = useState<number[]>([]);
  const [d, setD] = useState<Dentition>('permanent');
  return (
    <ToothChart
      selected={sel}
      onToggle={(n) => {
        const next = sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n];
        setSel(next);
        onSel(next);
      }}
      findings={findings}
      visits={[]}
      dentition={d}
      onDentition={setD}
    />
  );
}

describe('tooth chart', () => {
  it('shows 32 permanent teeth in FDI numbering, 20 primary, 52 mixed', () => {
    localStorage.setItem('clinic.lang', JSON.stringify('en'));
    renderWithProviders(<Harness />);
    const count = () => document.querySelectorAll('g[data-testid^="tooth-"]').length;
    expect(count()).toBe(32);
    expect(screen.getByTestId('tooth-18')).toBeInTheDocument();
    expect(screen.getByTestId('tooth-48')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Primary'));
    expect(count()).toBe(20);
    expect(screen.getByTestId('tooth-55')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mixed'));
    expect(count()).toBe(52);
  });

  it('selects and deselects teeth, and draws markers by category', () => {
    const onSel = vi.fn();
    const findings: Finding[] = [
      { id: 1, patient_id: 1, tooth_fdi: 36, category: 'endodontic', description: '', visit_id: null, created_at: '2026-11-01T10:00:00+03:00', created_by: 1 },
      { id: 2, patient_id: 1, tooth_fdi: 36, category: 'restoration', description: '', visit_id: null, created_at: '2026-11-02T10:00:00+03:00', created_by: 1 },
    ];
    renderWithProviders(<Harness findings={findings} onSel={onSel} />);
    fireEvent.click(screen.getByTestId('tooth-11'));
    fireEvent.click(screen.getByTestId('tooth-21'));
    expect(onSel).toHaveBeenLastCalledWith([11, 21]);
    expect(screen.getByTestId('tooth-11')).toHaveAttribute('data-selected', 'true');
    fireEvent.click(screen.getByTestId('tooth-11'));
    expect(onSel).toHaveBeenLastCalledWith([21]);
    expect(screen.getByTestId('marker-36-endodontic')).toBeInTheDocument();
    expect(screen.getByTestId('marker-36-restoration')).toBeInTheDocument();
  });
});
