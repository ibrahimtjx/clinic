import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import type { AppointmentStatus, Clinic, ClinicInfo, Department, Doctor, PhraseField, ReferralSource, SavedPhrase, Service, VisitType } from './types';

export type Resource =
  | 'clinics'
  | 'departments'
  | 'appointment-statuses'
  | 'visit-types'
  | 'saved-phrases'
  | 'services'
  | 'doctors'
  | 'insurance-companies'
  | 'medications'
  | 'lab-tests'
  | 'referral-sources';

interface ListOpts {
  includeInactive?: boolean;
  includeDeleted?: boolean;
  fieldKey?: PhraseField;
  enabled?: boolean;
}

export const masterKey = (r: Resource, o: ListOpts = {}) => ['master', r, o.includeInactive ?? false, o.includeDeleted ?? false, o.fieldKey ?? null] as const;

export function useList<T>(resource: Resource, o: ListOpts = {}) {
  return useQuery({
    queryKey: masterKey(resource, o),
    queryFn: () =>
      api<T[]>(`/${resource}`, {
        query: { include_inactive: o.includeInactive || undefined, include_deleted: o.includeDeleted || undefined, field_key: o.fieldKey },
      }),
    staleTime: 60_000,
    enabled: o.enabled ?? true,
  });
}

export const useClinics = (o?: ListOpts) => useList<Clinic>('clinics', o);
export const useDepartments = (o?: ListOpts) => useList<Department>('departments', o);
export const useStatuses = (o?: ListOpts) => useList<AppointmentStatus>('appointment-statuses', o);
export const useVisitTypes = (o?: ListOpts) => useList<VisitType>('visit-types', o);
export const useReferralSources = (o?: ListOpts) => useList<ReferralSource>('referral-sources', o);
export const useServices = (o?: ListOpts) => useList<Service>('services', o);
export const useDoctors = (o?: ListOpts) => useList<Doctor>('doctors', o);
export const usePhrases = (fieldKey: PhraseField | undefined, o: ListOpts = {}) =>
  useList<SavedPhrase>('saved-phrases', { ...o, fieldKey, enabled: (o.enabled ?? true) && !!fieldKey });

export const useClinicInfo = (enabled = true) =>
  useQuery({ queryKey: ['settings', 'clinic'], queryFn: () => api<ClinicInfo>('/settings/clinic'), staleTime: 5 * 60_000, enabled });

/** Bilingual name in the UI language. */
export const nameOf = (x: { name_ar: string; name_en: string } | undefined | null, lang: 'ar' | 'en') =>
  x ? (lang === 'ar' ? x.name_ar || x.name_en : x.name_en || x.name_ar) : '';
