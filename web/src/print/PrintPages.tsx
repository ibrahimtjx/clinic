import { Divider, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAppointmentsRange } from '../appointments/queries';
import { todayStr } from '../appointments/time';
import type { Appointment } from '../appointments/types';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatTime } from '../lib/format';
import { nameOf, useDoctors, useStatuses, useVisitTypes } from '../master/queries';
import classes from './Print.module.css';
import { PrintLayout } from './PrintLayout';

/** Appointment slip for the patient (SPEC 6.2), receipt-printer width. */
export function AppointmentSlip() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { id } = useParams();
  const a = useQuery({ queryKey: ['appointments', 'one', id], queryFn: () => api<Appointment>(`/appointments/${id}`) });
  const doctors = useDoctors({ includeInactive: true });
  const vts = useVisitTypes({ includeInactive: true });
  const row = (label: string, value: string | number | null | undefined) =>
    value ? (
      <Text size="sm">
        <b>{label}:</b> {value}
      </Text>
    ) : null;
  const d = a.data;
  return (
    <PrintLayout title={t('print.slipTitle')} ready={!!d && !!doctors.data} size="slip">
      {d && (
        <Stack gap={4} data-testid="slip">
          {row(t('appointments.patient'), d.patient && nameOf(d.patient, lang))}
          {row(t('patients.fileNo'), d.patient?.file_no)}
          {row(t('appointments.doctor'), nameOf(doctors.data?.find((x) => x.id === d.doctor_id), lang))}
          {row(t('sample.date'), formatDate(d.starts_at, lang, digits))}
          {row(t('sample.time'), `${formatTime(d.starts_at, lang, digits)} – ${formatTime(d.ends_at, lang, digits)}`)}
          {row(t('sample.visitType'), d.visit_type_id ? nameOf(vts.data?.find((v) => v.id === d.visit_type_id), lang) : null)}
          {row(t('sample.note'), d.note)}
          <Divider my="xs" />
          <Text size="xs">{t('print.slipFooter')}</Text>
        </Stack>
      )}
    </PrintLayout>
  );
}

/** Day schedule per doctor (SPEC 6.1 "Print day", 11.2 daily schedule). */
export function DaySchedule() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const [params] = useSearchParams();
  const date = params.get('date') ?? todayStr();
  const filter = (params.get('doctors') ?? '').split(',').filter(Boolean).map(Number);
  const doctors = useDoctors();
  const statuses = useStatuses({ includeInactive: true });
  const vts = useVisitTypes({ includeInactive: true });
  const list = (doctors.data ?? []).filter((d) => !filter.length || filter.includes(d.id));
  const appts = useAppointmentsRange(date, date, list.map((d) => d.id), list.length > 0);
  const rows = (appts.data ?? []).filter((a) => a.blocks_slot);
  return (
    <PrintLayout title={`${t('print.dayTitle')} · ${formatDate(`${date}T12:00:00+03:00`, lang, digits)}`} ready={!!appts.data && !!statuses.data}>
      {list.map((d) => {
        const mine = rows.filter((a) => a.doctor_id === d.id);
        return (
          <div key={d.id} style={{ breakInside: 'avoid', marginBottom: 16 }}>
            <Text fw={700} mb={4}>
              {nameOf(d, lang)} ({mine.length})
            </Text>
            <Table className={classes.table} withTableBorder data-testid={`print-doctor-${d.id}`}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('sample.time')} / Time</Table.Th>
                  <Table.Th>{t('appointments.patient')} / Patient</Table.Th>
                  <Table.Th>{t('patients.fileNo')} / File</Table.Th>
                  <Table.Th>{t('patients.fields.mobile')} / Mobile</Table.Th>
                  <Table.Th>{t('sample.visitType')} / Type</Table.Th>
                  <Table.Th>{t('sample.status')} / Status</Table.Th>
                  <Table.Th>{t('sample.note')} / Note</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {mine.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>
                      {formatTime(a.starts_at, lang, digits)}–{formatTime(a.ends_at, lang, digits)}
                    </Table.Td>
                    <Table.Td>{a.patient && nameOf(a.patient, lang)}</Table.Td>
                    <Table.Td>{a.patient?.file_no}</Table.Td>
                    <Table.Td dir="ltr">{a.patient?.mobile}</Table.Td>
                    <Table.Td>{a.visit_type_id ? nameOf(vts.data?.find((v) => v.id === a.visit_type_id), lang) : ''}</Table.Td>
                    <Table.Td>{nameOf(statuses.data?.find((s) => s.id === a.status_id), lang)}</Table.Td>
                    <Table.Td>{a.note}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        );
      })}
    </PrintLayout>
  );
}

/** Test page for the printer setup of this PC (Settings → This PC). */
export function TestPrint() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { kind } = useParams();
  const slip = kind === 'receipt';
  return (
    <PrintLayout title={t('thisPc.testTitle')} ready size={slip ? 'slip' : 'a4'}>
      <Stack gap={4} data-testid="test-print">
        <Text>اختبار الطباعة · Print test</Text>
        <Text size="sm">{slip ? 'طابعة الإيصالات 80 مم · Receipt printer 80 mm' : 'طابعة A4 · A4 printer'}</Text>
        <Text size="sm">{formatDateTime(new Date(), lang, digits)}</Text>
        <Text size="sm">٠١٢٣٤٥٦٧٨٩ · 0123456789 · 1,234.50 ر.س</Text>
      </Stack>
    </PrintLayout>
  );
}
