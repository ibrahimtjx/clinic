import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { isoAt } from './time';
import type { Appointment, WaitingEntry } from './types';

export const apptKeys = {
  range: (from: string, to: string, doctors: number[]) => ['appointments', 'range', from, to, doctors.join(',')] as const,
  patient: (id: number) => ['appointments', 'patient', id] as const,
  waiting: ['appointments', 'waiting'] as const,
};

/** Appointments for local dates [from, to] (inclusive). */
export function useAppointmentsRange(from: string, to: string, doctorIds: number[], enabled = true) {
  return useQuery({
    queryKey: apptKeys.range(from, to, doctorIds),
    queryFn: ({ signal }) =>
      api<Appointment[]>('/appointments', {
        query: { start: isoAt(from, 0), end: isoAt(to, 24 * 60), doctor_ids: doctorIds.length ? doctorIds.join(',') : undefined },
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000, // other receptionists' bookings appear without a reload
    enabled,
  });
}

export const usePatientAppointments = (patientId: number) =>
  useQuery({ queryKey: apptKeys.patient(patientId), queryFn: () => api<Appointment[]>('/appointments', { query: { patient_id: patientId } }) });

export const useWaitingList = (enabled = true) =>
  useQuery({ queryKey: apptKeys.waiting, queryFn: () => api<WaitingEntry[]>('/waiting-list'), enabled, refetchInterval: 60_000 });
