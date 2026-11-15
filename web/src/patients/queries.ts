import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useList } from '../master/queries';
import type { Assignment, InsuranceCompany, Patient, PatientFilters, PatientListItem, PatientQuick } from './types';

export const patientKeys = {
  list: (f: PatientFilters, page: number, size: number) => ['patients', 'list', f, page, size] as const,
  one: (id: number) => ['patients', 'one', id] as const,
  quick: (q: string) => ['patients', 'quick', q] as const,
};

export function usePatientList(f: PatientFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: patientKeys.list(f, page, pageSize),
    queryFn: ({ signal }) =>
      api<{ items: PatientListItem[]; total: number }>('/patients', {
        query: {
          ...(f as Record<string, string | number | boolean | null | undefined>),
          q: f.q?.trim() || undefined,
          page,
          page_size: pageSize,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export const usePatient = (id: number) => useQuery({ queryKey: patientKeys.one(id), queryFn: () => api<Patient>(`/patients/${id}`) });

export function useQuickSearch(q: string, enabled = true) {
  const term = q.trim();
  return useQuery({
    queryKey: patientKeys.quick(term),
    queryFn: ({ signal }) => api<PatientQuick[]>('/patients/search', { query: { q: term, limit: 8 }, signal }),
    enabled: enabled && term.length > 0,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}

export const useInsuranceCompanies = (includeInactive = false) =>
  useList<InsuranceCompany>('insurance-companies', { includeInactive });

export const useMyAssignments = (enabled: boolean) =>
  useQuery({ queryKey: ['assignments', 'mine'], queryFn: () => api<Assignment[]>('/assignments/mine'), enabled, refetchInterval: 60_000 });
