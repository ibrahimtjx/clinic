import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  ColorSwatch,
  Drawer,
  Group,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput, TimeInput } from '@mantine/dates';
import { useHotkeys, useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconCalendarSearch,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDental,
  IconDots,
  IconHourglass,
  IconMessage,
  IconPencil,
  IconPrinter,
  IconReceipt,
  IconSend,
  IconTag,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatTime } from '../lib/format';
import { nameOf, useDoctors, useServices, useStatuses, useVisitTypes } from '../master/queries';
import type { Doctor } from '../master/types';
import { SendToDoctorModal, type SendTarget } from '../queue/SendToDoctorModal';
import { AppointmentDrawer } from './AppointmentDrawer';
import { CalendarGrid, type Column, type MoveTarget } from './CalendarGrid';
import { useAppointmentsRange, useWaitingList } from './queries';
import { addDays, isoAt, local, localDate, minutesOf, todayStr, weekStart } from './time';
import type { Appointment, DraftAppointment, FreeSlot, WaitingEntry } from './types';
import { printDoc } from '../lib/print';

type View = 'day' | 'week' | 'list';

/** Appointments calendar (SPEC 6.1). */
export function CalendarPage() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const doctorsQ = useDoctors();
  const statusesQ = useStatuses({ includeInactive: true });
  const visitTypesQ = useVisitTypes({ includeInactive: true });
  const servicesQ = useServices({ includeInactive: true });
  const [date, setDate] = useState(params.get('date') ?? todayStr());
  const [view, setView] = useLocalStorage<View>({ key: 'clinic.calendarView', defaultValue: 'day' });
  const [doctorFilter, setDoctorFilter] = useLocalStorage<string[]>({ key: 'clinic.calendarDoctors', defaultValue: [] });
  const [showCancelled, setShowCancelled] = useLocalStorage({ key: 'clinic.calendarCancelled', defaultValue: false });
  const [drawer, setDrawer] = useState<{ appointment?: Appointment; draft?: DraftAppointment } | null>(
    params.get('new') === '1' ? { draft: { date: params.get('date') ?? todayStr(), patient_id: Number(params.get('patient')) || null, patient_label: params.get('label') ?? '' } } : null,
  );
  const [moving, setMoving] = useState<{ a: Appointment; target: MoveTarget; ack: string[] } | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [finder, setFinder] = useState(false);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [freed, setFreed] = useState<Appointment | null>(null);
  const [typeFor, setTypeFor] = useState<Appointment | null>(null);
  const [sendTarget, setSendTarget] = useState<SendTarget | null>(null);
  const [nowMin, setNowMin] = useState(minutesOf(new Date().toISOString()));

  useEffect(() => {
    const id = setInterval(() => setNowMin(minutesOf(new Date().toISOString())), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (params.get('new') === '1') {
      setDrawer({ draft: { date: params.get('date') ?? date, patient_id: Number(params.get('patient')) || null, patient_label: params.get('label') ?? '' } });
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const allDoctors = doctorsQ.data ?? [];
  const selected: Doctor[] = doctorFilter.length ? allDoctors.filter((d) => doctorFilter.includes(String(d.id))) : allDoctors;
  const weekDoctor = selected[0];
  const range = view === 'day' ? [date, date] : [weekStart(date), addDays(weekStart(date), 6)];
  const ids = view === 'week' && weekDoctor ? [weekDoctor.id] : selected.map((d) => d.id);
  const apptsQ = useAppointmentsRange(range[0], range[1], ids, allDoctors.length > 0);

  const statuses = useMemo(() => new Map((statusesQ.data ?? []).map((s) => [s.id, s])), [statusesQ.data]);
  const visitTypes = useMemo(() => new Map((visitTypesQ.data ?? []).map((v) => [v.id, v])), [visitTypesQ.data]);
  const services = useMemo(() => new Map((servicesQ.data ?? []).map((s) => [s.id, s])), [servicesQ.data]);
  const appointments = (apptsQ.data ?? []).filter((a) => showCancelled || a.blocks_slot);

  const columns: Column[] =
    view === 'week' && weekDoctor
      ? Array.from({ length: 7 }, (_, i) => {
          const d = addDays(range[0], i);
          return { key: d, date: d, doctor: weekDoctor, label: <DayHeader date={d} /> };
        })
      : selected.map((d) => ({ key: String(d.id), date, doctor: d, label: <DoctorHeader doctor={d} count={appointments.filter((a) => a.doctor_id === d.id && a.blocks_slot).length} /> }));

  // Visible hours: an hour around the earliest start and latest end in view, at least 08:00–22:00.
  const spans = columns.flatMap((c) => c.doctor.schedules.map((s) => [toMin(s.start_time), toMin(s.end_time)]));
  const apptSpans = appointments.map((a) => [minutesOf(a.starts_at), minutesOf(a.ends_at)]);
  const startMin = Math.max(0, Math.min(8 * 60, ...[...spans, ...apptSpans].map((x) => Math.floor(x[0] / 60) * 60 - 60)));
  const endMin = Math.min(24 * 60, Math.max(22 * 60, ...[...spans, ...apptSpans].map((x) => Math.ceil(x[1] / 60) * 60 + 60)));

  const step = view === 'day' ? 1 : 7;
  useHotkeys([
    ['alt+ArrowLeft', () => setDate(addDays(date, lang === 'ar' ? step : -step))],
    ['alt+ArrowRight', () => setDate(addDays(date, lang === 'ar' ? -step : step))],
    ['alt+T', () => setDate(todayStr())],
  ]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['appointments'] });
  const fail = (e: unknown) => notifications.show({ color: 'red', icon: <IconX size={18} />, message: errorMessage(t, e, lang) });

  async function setStatus(a: Appointment, key: string, reason?: string) {
    const st = (statusesQ.data ?? []).find((s) => s.key === key);
    if (!st) return;
    try {
      await api(`/appointments/${a.id}/status`, { method: 'POST', body: { version: a.version, status_id: st.id, cancel_reason: reason } });
      await refresh();
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      if (key === 'cancelled') setFreed(a);
    } catch (e) {
      fail(e);
    }
  }

  async function patch(a: Appointment, body: Record<string, unknown>) {
    try {
      await api(`/appointments/${a.id}`, { method: 'PATCH', body: { version: a.version, ...body } });
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  const cardMenu = (a: Appointment) => (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon size="xs" variant="subtle" color="neutral" onClick={(e) => e.stopPropagation()} aria-label={t('common.actions')} data-testid={`menu-${a.id}`}>
          <IconDots size={12} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setDrawer({ appointment: a })}>
          {t('common.edit')}
        </Menu.Item>
        {can('appointment.edit') && (
          <>
            <Menu.Item leftSection={<IconCheck size={14} />} onClick={() => void setStatus(a, 'confirmed')} disabled={!!a.confirmed_at} data-testid="menu-confirm">
              {t('appointments.confirm')}
            </Menu.Item>
            <Menu.Label>{t('appointments.changeStatus')}</Menu.Label>
            {(statusesQ.data ?? [])
              .filter((s) => s.is_active && s.id !== a.status_id && s.key !== 'cancelled' && s.key !== 'confirmed')
              .map((s) => (
                <Menu.Item key={s.id} leftSection={<ColorSwatch size={10} color={`var(--mantine-color-${s.color}-filled)`} />} onClick={() => void setStatus(a, s.key)}>
                  {nameOf(s, lang)}
                </Menu.Item>
              ))}
            <Menu.Divider />
            <Menu.Item leftSection={<IconTag size={14} />} onClick={() => setTypeFor(a)}>
              {t('appointments.changeVisitType')}
            </Menu.Item>
            <Menu.Item leftSection={<IconHourglass size={14} />} onClick={() => void moveToWaiting(a)} disabled={a.is_waiting_list}>
              {t('appointments.moveToWaiting')}
            </Menu.Item>
          </>
        )}
        {can('appointment.create') && (
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={() =>
              setDrawer({
                draft: {
                  patient_id: a.patient_id,
                  patient_label: a.patient ? `${nameOf(a.patient, lang)} · ${a.patient.file_no}` : '',
                  doctor_id: a.doctor_id,
                  date: localDate(a.starts_at),
                  start: minutesOf(a.starts_at),
                  duration: minutesOf(a.ends_at) - minutesOf(a.starts_at),
                  visit_type_id: a.visit_type_id,
                  service_id: a.service_id,
                },
              })
            }
          >
            {t('appointments.copy')}
          </Menu.Item>
        )}
        {can('appointment.edit') && a.blocks_slot && (
          <Menu.Item color="red" leftSection={<IconX size={14} />} onClick={() => setCancelling(a)} data-testid="menu-cancel">
            {t('appointments.cancel')}
          </Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item leftSection={<IconUser size={14} />} onClick={() => navigate(`/patients/${a.patient_id}`)}>
          {t('appointments.openPatient')}
        </Menu.Item>
        <Menu.Item leftSection={<IconDental size={14} />} onClick={() => navigate(`/patients/${a.patient_id}/dental`)}>
          {t('appointments.openDental')}
        </Menu.Item>
        <Menu.Item leftSection={<IconReceipt size={14} />} onClick={() => navigate(`/patients/${a.patient_id}/billing`)}>
          {t('appointments.viewInvoices')}
        </Menu.Item>
        {can('queue.manage') && a.blocks_slot && (
          <Menu.Item
            leftSection={<IconSend size={14} />}
            onClick={() =>
              setSendTarget({
                patient_id: a.patient_id,
                patient_label: a.patient ? `${nameOf(a.patient, lang)} · ${a.patient.file_no}` : '',
                doctor_id: a.doctor_id,
                appointment_id: a.id,
              })
            }
            data-testid="menu-send"
          >
            {t('patients.sendToDoctor')}
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconMessage size={14} />} disabled rightSection={<Text size="xs">{t('common.comingSoon')}</Text>}>
          {t('appointments.smsReminder')}
        </Menu.Item>
        <Menu.Item leftSection={<IconPrinter size={14} />} onClick={() => void printDoc(`/print/slip/${a.id}`)}>
          {t('appointments.printSlip')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  async function moveToWaiting(a: Appointment) {
    try {
      await api(`/appointments/${a.id}/waiting-list`, { method: 'POST', body: {} });
      await refresh();
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('appointments.addedToWaiting') });
    } catch (e) {
      fail(e);
    }
  }

  const doctorById = (id: number | null) => allDoctors.find((d) => d.id === id);

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="xs" wrap="wrap">
          <Title order={1} me="sm">
            {t('nav.appointments')}
          </Title>
          <Button variant="default" onClick={() => setDate(todayStr())} data-testid="today">
            {t('appointments.today')}
          </Button>
          <ActionIcon variant="default" size="lg" onClick={() => setDate(addDays(date, -step))} aria-label={t('appointments.previous')}>
            {lang === 'ar' ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
          </ActionIcon>
          <ActionIcon variant="default" size="lg" onClick={() => setDate(addDays(date, step))} aria-label={t('appointments.next')} data-testid="next-day">
            {lang === 'ar' ? <IconChevronLeft size={18} /> : <IconChevronRight size={18} />}
          </ActionIcon>
          <DatePickerInput
            value={dayjs(date).toDate()}
            onChange={(d) => d && setDate(dayjs(d).format('YYYY-MM-DD'))}
            valueFormat={view === 'day' ? 'dddd DD/MM/YYYY' : 'DD/MM/YYYY'}
            w={210}
            data-testid="calendar-date"
          />
        </Group>
        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as View)}
            data={[
              { value: 'day', label: t('appointments.views.day') },
              { value: 'week', label: t('appointments.views.week') },
              { value: 'list', label: t('appointments.views.list') },
            ]}
            data-testid="view-switch"
          />
          <MultiSelect
            placeholder={doctorFilter.length ? undefined : t('appointments.allDoctors')}
            data={allDoctors.map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
            value={doctorFilter}
            onChange={setDoctorFilter}
            clearable
            w={260}
            maxValues={view === 'week' ? 1 : undefined}
            data-testid="doctor-filter"
          />
          <Switch label={t('appointments.showCancelled')} checked={showCancelled} onChange={(e) => setShowCancelled(e.currentTarget.checked)} />
          <Tooltip label={t('appointments.findSlot')}>
            <ActionIcon variant="default" size="lg" onClick={() => setFinder(true)} aria-label={t('appointments.findSlot')} data-testid="find-slot">
              <IconCalendarSearch size={18} />
            </ActionIcon>
          </Tooltip>
          <WaitingButton onClick={() => setWaitingOpen(true)} />
          <Tooltip label={t('appointments.printDay')}>
            <ActionIcon
              variant="default"
              size="lg"
              onClick={() => void printDoc(`/print/day?date=${date}${doctorFilter.length ? `&doctors=${doctorFilter.join(',')}` : ''}`)}
              aria-label={t('appointments.printDay')}
            >
              <IconPrinter size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {doctorsQ.isPending || statusesQ.isPending ? (
        <Skeleton height={500} radius="md" />
      ) : allDoctors.length === 0 ? (
        <Card>
          <EmptyState icon={IconCalendarSearch} title={t('doctors.emptyTitle')} hint={t('doctors.emptyHint')} />
        </Card>
      ) : apptsQ.isError ? (
        <Alert color="red" variant="light">
          {errorMessage(t, apptsQ.error, lang)}
        </Alert>
      ) : view === 'list' ? (
        <AgendaList appointments={appointments} range={range} statuses={statuses} visitTypes={visitTypes} doctorById={doctorById} onOpen={(a) => setDrawer({ appointment: a })} />
      ) : (
        <CalendarGrid
          columns={columns}
          appointments={appointments}
          statuses={statuses}
          visitTypes={visitTypes}
          services={services}
          startMin={startMin}
          endMin={endMin}
          nowMin={nowMin}
          canEdit={can('appointment.edit')}
          onSlotClick={(col, minutes) =>
            can('appointment.create') && setDrawer({ draft: { doctor_id: col.doctor.id, date: col.date, start: minutes, duration: col.doctor.slot_minutes } })
          }
          onCardClick={(a) => setDrawer({ appointment: a })}
          onMove={(a, target) => setMoving({ a, target, ack: [] })}
          cardMenu={cardMenu}
        />
      )}

      <AppointmentDrawer opened={drawer !== null} appointment={drawer?.appointment} draft={drawer?.draft} onClose={() => setDrawer(null)} />
      <MoveConfirm move={moving} doctorById={doctorById} onClose={() => setMoving(null)} onAck={(ack) => moving && setMoving({ ...moving, ack })} onDone={() => void refresh()} />
      <Modal opened={typeFor !== null} onClose={() => setTypeFor(null)} title={t('appointments.changeVisitType')} size="xs">
        <Stack gap={4}>
          {(visitTypesQ.data ?? [])
            .filter((v) => v.is_active)
            .map((v) => (
              <Button
                key={v.id}
                variant={typeFor?.visit_type_id === v.id ? 'filled' : 'light'}
                color={v.color}
                onClick={() => {
                  if (typeFor) void patch(typeFor, { visit_type_id: v.id });
                  setTypeFor(null);
                }}
              >
                {nameOf(v, lang)}
              </Button>
            ))}
        </Stack>
      </Modal>
      <SendToDoctorModal target={sendTarget} onClose={() => setSendTarget(null)} />
      <CancelModal appointment={cancelling} onClose={() => setCancelling(null)} onConfirm={(a, reason) => void setStatus(a, 'cancelled', reason)} />
      <FreeSlotFinder
        opened={finder}
        onClose={() => setFinder(false)}
        doctors={allDoctors}
        onPick={(s) => {
          setFinder(false);
          setDate(localDate(s.starts_at));
          setDrawer({ draft: { doctor_id: s.doctor_id, date: localDate(s.starts_at), start: minutesOf(s.starts_at), duration: minutesOf(s.ends_at) - minutesOf(s.starts_at) } });
        }}
      />
      <WaitingPanel
        opened={waitingOpen || freed !== null}
        freed={freed}
        doctorById={doctorById}
        onClose={() => {
          setWaitingOpen(false);
          setFreed(null);
        }}
        onOffer={(entry, slot) => {
          setWaitingOpen(false);
          setFreed(null);
          setDrawer({
            draft: {
              patient_id: entry.patient_id,
              patient_label: `${nameOf({ name_ar: entry.patient_name_ar, name_en: entry.patient_name_en }, lang)} · ${entry.patient_file_no}`,
              doctor_id: slot.doctor_id,
              date: localDate(slot.starts_at),
              start: minutesOf(slot.starts_at),
              duration: minutesOf(slot.ends_at) - minutesOf(slot.starts_at),
              waitingEntryId: entry.id,
            },
          });
        }}
      />
      <Text size="xs" c="dimmed">
        {t('appointments.shortcuts')} · {formatDate(isoAt(date, 12 * 60), lang, digits)}
      </Text>
    </Stack>
  );
}

const toMin = (hms: string) => {
  const [h, m] = hms.split(':').map(Number);
  return h * 60 + m;
};

function DoctorHeader({ doctor, count }: { doctor: Doctor; count: number }) {
  const { lang } = usePrefs();
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <Group gap={6} wrap="nowrap">
        <ColorSwatch size={10} color={`var(--mantine-color-${doctor.color}-filled)`} />
        <Text size="sm" fw={600} lineClamp={1}>
          {nameOf(doctor, lang)}
        </Text>
      </Group>
      <Badge size="sm" variant="light" color="neutral">
        {count}
      </Badge>
    </Group>
  );
}

function DayHeader({ date }: { date: string }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const days = t('weekdays', { returnObjects: true }) as string[];
  return (
    <Text size="sm" fw={600} c={date === todayStr() ? 'accent' : undefined}>
      {days[dayjs(date).day()]} {formatDate(isoAt(date, 12 * 60), lang, digits).slice(0, 5)}
    </Text>
  );
}

function WaitingButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  const w = useWaitingList();
  return (
    <Tooltip label={t('appointments.waitingList')}>
      <Button variant="default" leftSection={<IconHourglass size={16} />} onClick={onClick} data-testid="waiting-open">
        {w.data?.length ?? 0}
      </Button>
    </Tooltip>
  );
}

function AgendaList({
  appointments,
  range,
  statuses,
  visitTypes,
  doctorById,
  onOpen,
}: {
  appointments: Appointment[];
  range: string[];
  statuses: Map<number, { name_ar: string; name_en: string; color: string }>;
  visitTypes: Map<number, { name_ar: string; name_en: string }>;
  doctorById: (id: number) => Doctor | undefined;
  onOpen: (a: Appointment) => void;
}) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const days = Array.from({ length: dayjs(range[1]).diff(range[0], 'day') + 1 }, (_, i) => addDays(range[0], i));
  return (
    <Card padding={0} data-testid="agenda">
      <Table.ScrollContainer minWidth={800}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('sample.time')}</Table.Th>
              <Table.Th>{t('appointments.patient')}</Table.Th>
              <Table.Th>{t('appointments.doctor')}</Table.Th>
              <Table.Th>{t('sample.visitType')}</Table.Th>
              <Table.Th>{t('sample.status')}</Table.Th>
              <Table.Th>{t('sample.note')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {days.map((d) => {
              const items = appointments.filter((a) => localDate(a.starts_at) === d);
              return [
                <Table.Tr key={d}>
                  <Table.Td colSpan={6} bg="var(--app-bg)" fw={600}>
                    <DayHeader date={d} /> <Text span size="xs" c="dimmed">({items.length})</Text>
                  </Table.Td>
                </Table.Tr>,
                ...items.map((a) => {
                  const st = statuses.get(a.status_id);
                  const vt = a.visit_type_id ? visitTypes.get(a.visit_type_id) : undefined;
                  return (
                    <Table.Tr key={a.id} onClick={() => onOpen(a)} style={{ cursor: 'pointer' }}>
                      <Table.Td fz="sm">
                        {formatTime(a.starts_at, lang, digits)} – {formatTime(a.ends_at, lang, digits)}
                      </Table.Td>
                      <Table.Td>
                        {a.patient && nameOf(a.patient, lang)}{' '}
                        <Text span size="xs" c="dimmed">
                          {a.patient?.file_no}
                        </Text>
                      </Table.Td>
                      <Table.Td>{nameOf(doctorById(a.doctor_id), lang)}</Table.Td>
                      <Table.Td>{vt ? nameOf(vt, lang) : '—'}</Table.Td>
                      <Table.Td>{st && <Badge color={st.color}>{nameOf(st, lang)}</Badge>}</Table.Td>
                      <Table.Td fz="sm" c="dimmed">
                        {a.note}
                      </Table.Td>
                    </Table.Tr>
                  );
                }),
              ];
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

/** Drag and resize both ask before saving (SPEC 6.1), then go through the same warnings as booking. */
function MoveConfirm({
  move,
  doctorById,
  onClose,
  onAck,
  onDone,
}: {
  move: { a: Appointment; target: MoveTarget; ack: string[] } | null;
  doctorById: (id: number) => Doctor | undefined;
  onClose: () => void;
  onAck: (ack: string[]) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(null), [move?.a.id, move?.target.start, move?.target.doctor_id]);
  if (!move) return null;
  const { a, target } = move;
  const warnings = error instanceof ApiError && error.code === 'needs_confirmation' ? (error.detail?.warnings as string[]) : null;

  async function go(ack: string[]) {
    setBusy(true);
    try {
      await api(`/appointments/${a.id}`, {
        method: 'PATCH',
        body: { version: a.version, doctor_id: target.doctor_id, starts_at: isoAt(target.date, target.start), ends_at: isoAt(target.date, target.end), acknowledge: ack },
      });
      onDone();
      onClose();
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
    } catch (e) {
      setError(e);
      onAck(ack);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={t('appointments.moveTitle')} size="sm" data-testid="move-confirm">
      <Stack>
        <Text size="sm">
          {t('appointments.moveBody', {
            name: a.patient ? nameOf(a.patient, lang) : '',
            doctor: nameOf(doctorById(target.doctor_id), lang),
            date: formatDate(isoAt(target.date, 12 * 60), lang, digits),
            from: formatTime(isoAt(target.date, target.start), lang, digits),
            to: formatTime(isoAt(target.date, target.end), lang, digits),
          })}
        </Text>
        {warnings && (
          <Alert color="yellow" variant="light">
            {warnings.map((w) => t(`appointments.warnings.${w}`)).join(' ')}
            {warnings.includes('outside_hours') && !can('appointment.override_hours') && <Text size="sm" fw={500}>{t('appointments.needsOverride')}</Text>}
          </Alert>
        )}
        {error !== null && !warnings && (
          <Alert color="red" variant="light">
            {error instanceof ApiError && error.code === 'overlap'
              ? t('appointments.overlapWith', {
                  name: (error.detail?.patient_name as string) ?? '',
                  from: formatTime(error.detail?.starts_at as string, lang, digits),
                  to: formatTime(error.detail?.ends_at as string, lang, digits),
                })
              : errorMessage(t, error, lang)}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {warnings ? (
            <Button color="yellow" onClick={() => void go(warnings)} loading={busy} disabled={warnings.includes('outside_hours') && !can('appointment.override_hours')}>
              {t('appointments.continueAnyway')}
            </Button>
          ) : (
            <Button onClick={() => void go(move.ack)} loading={busy} data-testid="move-ok" disabled={error !== null}>
              {t('appointments.moveOk')}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}

function CancelModal({ appointment, onClose, onConfirm }: { appointment: Appointment | null; onClose: () => void; onConfirm: (a: Appointment, reason: string) => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [appointment]);
  if (!appointment) return null;
  return (
    <Modal opened onClose={onClose} title={t('appointments.cancelTitle')} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(appointment, reason.trim());
          onClose();
        }}
      >
        <Stack>
          <TextInput label={t('appointments.cancelReason')} value={reason} onChange={(e) => setReason(e.currentTarget.value)} required data-autofocus data-testid="cancel-reason" />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button color="red" type="submit" disabled={!reason.trim()} data-testid="cancel-ok">
              {t('appointments.cancel')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** "Find next free slot" (SPEC 6.5). */
function FreeSlotFinder({ opened, onClose, doctors, onPick }: { opened: boolean; onClose: () => void; doctors: Doctor[]; onPick: (s: FreeSlot) => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const [doctor, setDoctor] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(15);
  const [from, setFrom] = useState<Date | null>(new Date());
  const [prefFrom, setPrefFrom] = useState('');
  const [prefTo, setPrefTo] = useState('');
  const q = useQuery({
    queryKey: ['appointments', 'free', doctor, duration, from && dayjs(from).format('YYYY-MM-DD'), prefFrom, prefTo],
    queryFn: () =>
      api<FreeSlot[]>('/appointments/free-slots', {
        query: {
          doctor_ids: doctor ?? undefined,
          duration,
          from: from ? dayjs(from).format('YYYY-MM-DD') : undefined,
          preferred_from: /^\d{2}:\d{2}$/.test(prefFrom) ? prefFrom : undefined,
          preferred_to: /^\d{2}:\d{2}$/.test(prefTo) ? prefTo : undefined,
          limit: 15,
        },
      }),
    enabled: opened && duration > 0,
  });
  const days = t('weekdays', { returnObjects: true }) as string[];
  return (
    <Modal opened={opened} onClose={onClose} title={t('appointments.findSlot')} size="lg">
      <Stack>
        <Group grow align="flex-end">
          <Select label={t('appointments.doctor')} placeholder={t('appointments.anyDoctor')} data={doctors.map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))} value={doctor} onChange={setDoctor} clearable />
          <NumberInput label={t('appointments.duration')} value={duration} onChange={(v) => setDuration(Number(v) || 15)} min={5} max={480} step={5} allowDecimal={false} />
          <DatePickerInput label={t('appointments.fromDate')} value={from} onChange={setFrom} valueFormat="DD/MM/YYYY" />
        </Group>
        <Group grow>
          <TimeInput label={t('appointments.preferredFrom')} value={prefFrom} onChange={(e) => setPrefFrom(e.currentTarget.value)} />
          <TimeInput label={t('appointments.preferredTo')} value={prefTo} onChange={(e) => setPrefTo(e.currentTarget.value)} />
        </Group>
        {q.isPending ? (
          <Skeleton height={120} />
        ) : q.isError ? (
          <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>
        ) : q.data.length === 0 ? (
          <Text c="dimmed" size="sm">
            {t('appointments.noSlots')}
          </Text>
        ) : (
          <Stack gap={4} data-testid="free-slots">
            {q.data.map((s) => (
              <Button key={`${s.doctor_id}-${s.starts_at}`} variant="light" justify="space-between" onClick={() => onPick(s)} rightSection={nameOf(doctors.find((d) => d.id === s.doctor_id), lang)}>
                {days[local(s.starts_at).day()]} {formatDate(s.starts_at, lang, digits)} · {formatTime(s.starts_at, lang, digits)} – {formatTime(s.ends_at, lang, digits)}
              </Button>
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

/** Waiting list side panel (SPEC 6.6). After a cancellation it highlights who could take the freed slot. */
function WaitingPanel({
  opened,
  freed,
  doctorById,
  onClose,
  onOffer,
}: {
  opened: boolean;
  freed: Appointment | null;
  doctorById: (id: number) => Doctor | undefined;
  onClose: () => void;
  onOffer: (e: WaitingEntry, slot: { doctor_id: number; starts_at: string; ends_at: string }) => void;
}) {
  const { t, i18n } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useWaitingList(opened);
  const matches = useQuery({
    queryKey: ['appointments', 'waiting', 'matches', freed?.id],
    queryFn: () => api<WaitingEntry[]>('/waiting-list/matches', { query: { doctor_id: freed!.doctor_id, starts_at: freed!.starts_at, ends_at: freed!.ends_at } }),
    enabled: !!freed,
  });
  const matchIds = new Set((matches.data ?? []).map((m) => m.id));
  const days = t('weekdays', { returnObjects: true }) as string[];
  const [adding, setAdding] = useState(false);

  const entries = [...(list.data ?? [])].sort((a, b) => Number(matchIds.has(b.id)) - Number(matchIds.has(a.id)));

  return (
    <Drawer opened={opened} onClose={onClose} position={i18n.dir() === 'rtl' ? 'left' : 'right'} title={t('appointments.waitingList')} size="md" data-testid="waiting-panel">
      <Stack>
        {freed && (
          <Alert color={matchIds.size ? 'green' : 'blue'} variant="light" data-testid="freed-alert">
            {matchIds.size
              ? t('appointments.freedMatches', { count: matchIds.size, time: formatTime(freed.starts_at, lang, digits) })
              : t('appointments.freedNoMatch', { time: formatTime(freed.starts_at, lang, digits) })}
          </Alert>
        )}
        {can('appointment.create') && !adding && (
          <Button variant="light" onClick={() => setAdding(true)}>
            {t('appointments.addToWaiting')}
          </Button>
        )}
        {adding && <WaitingForm onDone={() => setAdding(false)} />}
        {entries.length === 0 && <Text c="dimmed" size="sm">{t('appointments.waitingEmpty')}</Text>}
        {entries.map((e) => (
          <Card key={e.id} padding="sm" withBorder bg={matchIds.has(e.id) ? 'var(--mantine-color-green-light)' : undefined} data-testid={`waiting-${e.id}`}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <div>
                <Text size="sm" fw={600}>
                  {nameOf({ name_ar: e.patient_name_ar, name_en: e.patient_name_en }, lang)} · {e.patient_file_no}
                </Text>
                <Text size="xs" c="dimmed">
                  {e.doctor_id ? nameOf(doctorById(e.doctor_id), lang) : t('appointments.anyDoctor')}
                  {e.preferred_days.length ? ` · ${e.preferred_days.map((d) => days[d]).join('، ')}` : ''}
                  {e.preferred_from || e.preferred_to ? ` · ${e.preferred_from ?? ''}–${e.preferred_to ?? ''}` : ''}
                </Text>
                {e.appointment_starts_at && (
                  <Text size="xs">{t('appointments.currentBooking', { when: `${formatDate(e.appointment_starts_at, lang, digits)} ${formatTime(e.appointment_starts_at, lang, digits)}` })}</Text>
                )}
                {e.note && <Text size="xs">{e.note}</Text>}
              </div>
              <Stack gap={4}>
                {freed && matchIds.has(e.id) && (
                  <Button size="xs" onClick={() => onOffer(e, freed)} data-testid={`offer-${e.id}`}>
                    {t('appointments.offerSlot')}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="subtle"
                  color="neutral"
                  onClick={async () => {
                    await api(`/waiting-list/${e.id}/resolve`, { method: 'POST' });
                    await qc.invalidateQueries({ queryKey: ['appointments'] });
                  }}
                >
                  {t('patients.markDone')}
                </Button>
              </Stack>
            </Group>
          </Card>
        ))}
      </Stack>
    </Drawer>
  );
}

function WaitingForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const doctors = useDoctors();
  const [patient, setPatient] = useState<{ id: number; label: string } | null>(null);
  const [search, setSearch] = useState('');
  const [doctor, setDoctor] = useState<string | null>(null);
  const [daysSel, setDaysSel] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const results = useQuery({
    queryKey: ['patients', 'quick', search],
    queryFn: () => api<{ id: number; file_no: number; name_ar: string; name_en: string }[]>('/patients/search', { query: { q: search } }),
    enabled: search.trim().length > 1 && !patient,
  });
  const days = t('weekdays', { returnObjects: true }) as string[];
  return (
    <Card withBorder padding="sm">
      <Stack gap="xs">
        {patient ? (
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              {patient.label}
            </Text>
            <ActionIcon variant="subtle" size="sm" onClick={() => setPatient(null)} aria-label={t('common.clear')}>
              <IconX size={14} />
            </ActionIcon>
          </Group>
        ) : (
          <>
            <TextInput label={t('appointments.patient')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder={t('patients.searchHint')} />
            {(results.data ?? []).slice(0, 5).map((p) => (
              <Button key={p.id} size="xs" variant="subtle" justify="flex-start" onClick={() => setPatient({ id: p.id, label: `${nameOf(p, lang)} · ${p.file_no}` })}>
                {nameOf(p, lang)} · {p.file_no}
              </Button>
            ))}
          </>
        )}
        <Select label={t('appointments.doctor')} placeholder={t('appointments.anyDoctor')} data={(doctors.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))} value={doctor} onChange={setDoctor} clearable />
        <MultiSelect label={t('appointments.preferredDays')} data={days.map((d, i) => ({ value: String(i), label: d }))} value={daysSel} onChange={setDaysSel} clearable />
        <Group grow>
          <TimeInput label={t('appointments.preferredFrom')} value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
          <TimeInput label={t('appointments.preferredTo')} value={to} onChange={(e) => setTo(e.currentTarget.value)} />
        </Group>
        <TextInput label={t('sample.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group gap="xs">
          <Button
            size="xs"
            disabled={!patient}
            onClick={async () => {
              await api('/waiting-list', {
                method: 'POST',
                body: { patient_id: patient!.id, doctor_id: doctor ? Number(doctor) : null, preferred_days: daysSel.map(Number), preferred_from: from || null, preferred_to: to || null, note },
              });
              await qc.invalidateQueries({ queryKey: ['appointments'] });
              onDone();
            }}
          >
            {t('common.save')}
          </Button>
          <Button size="xs" variant="default" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

