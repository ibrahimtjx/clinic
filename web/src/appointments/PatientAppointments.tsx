import { Badge, Button, Card, Group, Skeleton, Stack, Table, Text } from '@mantine/core';
import { IconCalendarEvent } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { usePrefs } from '../app/preferences';
import { EmptyState } from '../components/EmptyState';
import { formatDate, formatTime } from '../lib/format';
import { nameOf, useDoctors, useStatuses, useVisitTypes } from '../master/queries';
import { usePatientAppointments } from './queries';
import { localDate } from './time';
import type { Appointment } from './types';

/** Patient profile → Appointments tab: upcoming and past, with status (SPEC 5.2). */
export function PatientAppointments({ patientId }: { patientId: number }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const navigate = useNavigate();
  const q = usePatientAppointments(patientId);
  const doctors = useDoctors({ includeInactive: true });
  const statuses = useStatuses({ includeInactive: true });
  const vts = useVisitTypes({ includeInactive: true });
  if (q.isPending) return <Skeleton height={200} radius="md" />;
  const now = new Date().toISOString();
  const upcoming = (q.data ?? []).filter((a) => a.starts_at >= now);
  const past = (q.data ?? []).filter((a) => a.starts_at < now).reverse();
  if (!upcoming.length && !past.length) {
    return (
      <Card>
        <EmptyState icon={IconCalendarEvent} title={t('appointments.noneForPatient')} hint={t('appointments.noneForPatientHint')} />
      </Card>
    );
  }
  const table = (rows: Appointment[]) => (
    <Table.ScrollContainer minWidth={700}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('sample.date')}</Table.Th>
            <Table.Th>{t('sample.time')}</Table.Th>
            <Table.Th>{t('appointments.doctor')}</Table.Th>
            <Table.Th>{t('sample.visitType')}</Table.Th>
            <Table.Th>{t('sample.status')}</Table.Th>
            <Table.Th>{t('sample.note')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((a) => {
            const st = statuses.data?.find((s) => s.id === a.status_id);
            return (
              <Table.Tr key={a.id} onClick={() => navigate(`/appointments?date=${localDate(a.starts_at)}`)} style={{ cursor: 'pointer' }}>
                <Table.Td>{formatDate(a.starts_at, lang, digits)}</Table.Td>
                <Table.Td>{formatTime(a.starts_at, lang, digits)}</Table.Td>
                <Table.Td>{nameOf(doctors.data?.find((d) => d.id === a.doctor_id), lang)}</Table.Td>
                <Table.Td>{a.visit_type_id ? nameOf(vts.data?.find((v) => v.id === a.visit_type_id), lang) : '—'}</Table.Td>
                <Table.Td>{st && <Badge color={st.color}>{nameOf(st, lang)}</Badge>}</Table.Td>
                <Table.Td fz="sm" c="dimmed">
                  {a.cancel_reason ? `${t('appointments.cancelReason')}: ${a.cancel_reason}` : a.note}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
  return (
    <Stack data-testid="patient-appointments">
      <Card padding={0}>
        <Text fw={600} p="md" pb={0}>
          {t('patients.upcomingAppointments')} ({upcoming.length})
        </Text>
        {table(upcoming)}
      </Card>
      <Card padding={0}>
        <Text fw={600} p="md" pb={0}>
          {t('appointments.past')} ({past.length})
        </Text>
        {table(past)}
      </Card>
    </Stack>
  );
}

export function UpcomingCard({ patientId }: { patientId: number }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const navigate = useNavigate();
  const q = usePatientAppointments(patientId);
  const doctors = useDoctors({ includeInactive: true });
  const now = new Date().toISOString();
  const next = (q.data ?? []).filter((a) => a.starts_at >= now && a.blocks_slot).slice(0, 3);
  return (
    <Card data-testid="upcoming-card">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>{t('patients.upcomingAppointments')}</Text>
        <Button size="compact-xs" variant="subtle" onClick={() => navigate(`/patients/${patientId}/appointments`)}>
          {t('appointments.all')}
        </Button>
      </Group>
      {next.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('appointments.noUpcoming')}
        </Text>
      ) : (
        <Stack gap={6}>
          {next.map((a) => (
            <Text size="sm" key={a.id}>
              {formatDate(a.starts_at, lang, digits)} · {formatTime(a.starts_at, lang, digits)} · {nameOf(doctors.data?.find((d) => d.id === a.doctor_id), lang)}
            </Text>
          ))}
        </Stack>
      )}
    </Card>
  );
}
