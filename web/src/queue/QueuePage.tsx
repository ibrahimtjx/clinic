import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowsExchange,
  IconBell,
  IconClockPause,
  IconDoorEnter,
  IconDoorExit,
  IconDots,
  IconNote,
  IconPlus,
  IconUser,
  IconUserX,
  IconX,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { todayStr } from '../appointments/time';
import { useQuickSearch } from '../patients/queries';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatTime } from '../lib/format';
import { nameOf, useDoctors, useVisitTypes } from '../master/queries';
import { SendToDoctorModal, type SendTarget } from './SendToDoctorModal';
import type { QueueEntry, QueueReport, QueueSettings, Stage } from './types';

const COLUMNS: Stage[] = ['waiting', 'called', 'with_doctor', 'done'];

/** Patient queue (SPEC 7): board with Waiting / Called / With doctor / Done, and a table view with totals. */
export function QueuePage() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { me, can } = useAuth();
  const doctors = useDoctors();
  // A doctor sees their own column by default.
  const ownDoctor = doctors.data?.find((d) => d.user_id === me?.id);
  const [view, setView] = useLocalStorage<'board' | 'table'>({ key: 'clinic.queueView', defaultValue: 'board' });
  const [doctorFilter, setDoctorFilter] = useState<string | null>(null);
  const effectiveDoctor = doctorFilter ?? (ownDoctor ? String(ownDoctor.id) : null);
  const [walkIn, setWalkIn] = useState(false);
  const [sendTarget, setSendTarget] = useState<SendTarget | null>(null);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>{t('nav.queue')}</Title>
        <Group gap="xs">
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as 'board' | 'table')}
            data={[
              { value: 'board', label: t('queue.board') },
              { value: 'table', label: t('queue.table') },
            ]}
          />
          <Select
            placeholder={t('appointments.allDoctors')}
            data={(doctors.data ?? []).filter((d) => can('appointment.view_all') || d.user_id === me?.id).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
            value={effectiveDoctor}
            onChange={setDoctorFilter}
            clearable={can('appointment.view_all')}
            w={220}
            data-testid="queue-doctor"
          />
          {can('queue.manage') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setWalkIn(true)} data-testid="walk-in">
              {t('queue.walkIn')}
            </Button>
          )}
        </Group>
      </Group>
      {view === 'board' ? <Board doctorId={effectiveDoctor ? Number(effectiveDoctor) : null} /> : <ReportTable doctorId={effectiveDoctor ? Number(effectiveDoctor) : null} />}
      <WalkInPicker opened={walkIn} onClose={() => setWalkIn(false)} onPick={(target) => { setWalkIn(false); setSendTarget(target); }} />
      <SendToDoctorModal target={sendTarget} onClose={() => setSendTarget(null)} />
    </Stack>
  );
}

function useQueueSettings() {
  return useQuery({ queryKey: ['settings', 'queue'], queryFn: () => api<QueueSettings>('/settings/queue'), staleTime: 300_000 });
}

function waitColor(minutes: number, s: QueueSettings | undefined) {
  if (!s) return 'neutral';
  return minutes >= s.late_minutes ? 'red' : minutes >= s.warn_minutes ? 'yellow' : 'green';
}

function Board({ doctorId }: { doctorId: number | null }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const q = useQuery({
    queryKey: ['queue', 'board', doctorId],
    queryFn: () => api<QueueEntry[]>('/queue', { query: { doctor_id: doctorId ?? undefined } }),
    refetchInterval: 10_000, // calls from other rooms show up quickly
  });
  if (q.isPending) return <Skeleton height={400} radius="md" />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} data-testid="queue-board">
      {COLUMNS.map((stage) => {
        const items = q.data.filter((e) => e.stage === stage);
        return (
          <Card key={stage} padding="sm" bg="var(--app-bg)" withBorder data-testid={`queue-col-${stage}`}>
            <Group justify="space-between" mb="sm">
              <Text fw={600}>{t(`queue.stages.${stage}`)}</Text>
              <Badge variant="light" color="neutral">
                {items.length}
              </Badge>
            </Group>
            <ScrollArea.Autosize mah="calc(100vh - 260px)">
              <Stack gap="xs">
                {items.length === 0 && (
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    {t('queue.empty')}
                  </Text>
                )}
                {items.map((e) => (
                  <QueueCard key={e.id} entry={e} />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}

function QueueCard({ entry: e }: { entry: QueueEntry }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const doctors = useDoctors();
  const vts = useVisitTypes({ includeInactive: true });
  const settings = useQueueSettings();
  const [transfer, setTransfer] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const vt = vts.data?.find((v) => v.id === e.visit_type_id);
  const act = async (path: string, body?: unknown) => {
    try {
      await api(`/queue/${e.id}/${path}`, { method: 'POST', body });
      await qc.invalidateQueries({ queryKey: ['queue'] });
      await qc.invalidateQueries({ queryKey: ['appointments'] });
    } catch (err) {
      notifications.show({ color: 'red', icon: <IconX size={18} />, message: errorMessage(t, err, lang) });
    }
  };
  const manage = can('queue.manage');
  const active = e.stage === 'waiting' || e.stage === 'called' || e.stage === 'with_doctor';

  return (
    <Card padding="sm" shadow="xs" data-testid={`queue-card-${e.queue_no}`}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <Badge size="lg" radius="sm" variant="filled" color="accent" data-testid="queue-no">
            {e.queue_no}
          </Badge>
          <div>
            <Text size="sm" fw={600}>
              {nameOf({ name_ar: e.patient_name_ar, name_en: e.patient_name_en }, lang)}
            </Text>
            <Text size="xs" c="dimmed">
              {e.patient_file_no} · {nameOf(doctors.data?.find((d) => d.id === e.doctor_id), lang)}
            </Text>
          </div>
        </Group>
        {manage && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="neutral" size="sm" aria-label={t('common.actions')}>
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {e.stage === 'waiting' && (
                <Menu.Item leftSection={<IconClockPause size={14} />} onClick={() => void act('postpone')}>
                  {t('queue.postpone')}
                </Menu.Item>
              )}
              {(e.stage === 'waiting' || e.stage === 'called') && (
                <>
                  <Menu.Item leftSection={<IconArrowsExchange size={14} />} onClick={() => setTransfer(true)}>
                    {t('queue.transfer')}
                  </Menu.Item>
                  <Menu.Item leftSection={<IconUserX size={14} />} onClick={() => void act('left')}>
                    {t('queue.left')}
                  </Menu.Item>
                </>
              )}
              <Menu.Item leftSection={<IconNote size={14} />} onClick={() => setNoteOpen(true)}>
                {t('queue.addNote')}
              </Menu.Item>
              <Menu.Item leftSection={<IconUser size={14} />} onClick={() => navigate(`/patients/${e.patient_id}`)}>
                {t('appointments.openPatient')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Group gap={6} mt="xs">
        {vt && (
          <Badge size="xs" variant="light" color={vt.color}>
            {nameOf(vt, lang)}
          </Badge>
        )}
        {e.postponed && <Badge size="xs" color="orange">{t('queue.postponed')}</Badge>}
        {active && e.stage !== 'with_doctor' && (
          <Badge size="xs" color={waitColor(e.waited_minutes, settings.data)} data-testid="waited">
            {t('queue.waited', { n: e.waited_minutes })}
          </Badge>
        )}
        {e.stage === 'with_doctor' && e.entered_at && <Text size="xs" c="dimmed">{t('queue.since', { time: formatTime(e.entered_at, lang, digits) })}</Text>}
        {e.stage === 'done' && e.exited_at && <Text size="xs" c="dimmed">{formatTime(e.exited_at, lang, digits)}</Text>}
      </Group>
      {e.note && (
        <Text size="xs" mt={4}>
          {e.note}
        </Text>
      )}
      {manage && active && (
        <Group gap="xs" mt="xs">
          {e.stage === 'waiting' && (
            <Button size="compact-xs" variant="light" leftSection={<IconBell size={12} />} onClick={() => void act('call')} data-testid="q-call">
              {t('queue.call')}
            </Button>
          )}
          {(e.stage === 'waiting' || e.stage === 'called') && (
            <Button size="compact-xs" leftSection={<IconDoorEnter size={12} />} onClick={() => void act('start')} data-testid="q-start">
              {t('queue.start')}
            </Button>
          )}
          {e.stage === 'with_doctor' && (
            <Button size="compact-xs" color="green" leftSection={<IconDoorExit size={12} />} onClick={() => void act('finish')} data-testid="q-finish">
              {t('queue.finish')}
            </Button>
          )}
        </Group>
      )}
      <Modal opened={transfer} onClose={() => setTransfer(false)} title={t('queue.transfer')} size="xs">
        <Stack gap={4}>
          {(doctors.data ?? [])
            .filter((d) => d.id !== e.doctor_id)
            .map((d) => (
              <Button
                key={d.id}
                variant="light"
                onClick={() => {
                  setTransfer(false);
                  void act('transfer', { doctor_id: d.id });
                }}
              >
                {nameOf(d, lang)}
              </Button>
            ))}
        </Stack>
      </Modal>
      <NoteModal opened={noteOpen} initial={e.note} onClose={() => setNoteOpen(false)} onSave={(note) => void act('note', { note })} />
    </Card>
  );
}

function NoteModal({ opened, initial, onClose, onSave }: { opened: boolean; initial: string; onClose: () => void; onSave: (n: string) => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(initial);
  return (
    <Modal opened={opened} onClose={onClose} title={t('queue.addNote')} size="sm">
      <Stack>
        <TextInput value={note} onChange={(e) => setNote(e.currentTarget.value)} data-autofocus />
        <Group justify="flex-end">
          <Button
            onClick={() => {
              onSave(note);
              onClose();
            }}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function WalkInPicker({ opened, onClose, onPick }: { opened: boolean; onClose: () => void; onPick: (t: SendTarget) => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const [q, setQ] = useState('');
  const results = useQuickSearch(q, opened);
  return (
    <Modal opened={opened} onClose={onClose} title={t('queue.walkIn')} size="sm">
      <Stack gap="xs">
        <TextInput placeholder={t('patients.searchHint')} value={q} onChange={(e) => setQ(e.currentTarget.value)} data-autofocus data-testid="walkin-search" />
        {(results.data ?? []).map((p) => (
          <Button key={p.id} variant="subtle" justify="flex-start" onClick={() => onPick({ patient_id: p.id, patient_label: `${nameOf(p, lang)} · ${p.file_no}` })}>
            {nameOf(p, lang)} · {p.file_no}
          </Button>
        ))}
      </Stack>
    </Modal>
  );
}

function ReportTable({ doctorId }: { doctorId: number | null }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const doctors = useDoctors({ includeInactive: true });
  const [range, setRange] = useState<[Date | null, Date | null]>([dayjs(todayStr()).toDate(), dayjs(todayStr()).toDate()]);
  const from = range[0] ? dayjs(range[0]).format('YYYY-MM-DD') : todayStr();
  const to = range[1] ? dayjs(range[1]).format('YYYY-MM-DD') : from;
  const q = useQuery({
    queryKey: ['queue', 'report', from, to, doctorId],
    queryFn: () => api<QueueReport>('/queue/report', { query: { from, to, doctor_id: doctorId ?? undefined } }),
    refetchInterval: 30_000,
  });
  const time = (iso: string | null) => (iso ? formatTime(iso, lang, digits) : '—');
  return (
    <Stack>
      <Group align="flex-end">
        <DatePickerInput type="range" label={t('queue.dates')} value={range} onChange={setRange} valueFormat="DD/MM/YYYY" w={260} allowSingleDateInRange />
      </Group>
      {q.data && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} data-testid="queue-totals">
          <Total label={t('queue.total')} value={q.data.total} />
          <Total label={t('queue.seen')} value={q.data.seen} />
          <Total label={t('queue.notSeen')} value={q.data.not_seen} />
          <Total label={t('queue.avgWait')} value={q.data.average_wait_minutes == null ? '—' : t('queue.minutes', { n: q.data.average_wait_minutes })} />
        </SimpleGrid>
      )}
      <Card padding={0}>
        {q.isPending ? (
          <Skeleton height={200} />
        ) : q.isError ? (
          <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>
        ) : (
          <Table.ScrollContainer minWidth={1100}>
            <Table data-testid="queue-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>{t('sample.date')}</Table.Th>
                  <Table.Th>{t('appointments.patient')}</Table.Th>
                  <Table.Th>{t('appointments.doctor')}</Table.Th>
                  <Table.Th>{t('queue.receivedAt')}</Table.Th>
                  <Table.Th>{t('queue.calledAt')}</Table.Th>
                  <Table.Th>{t('queue.enteredAt')}</Table.Th>
                  <Table.Th>{t('queue.exitedAt')}</Table.Th>
                  <Table.Th>{t('queue.wait')}</Table.Th>
                  <Table.Th>{t('sample.status')}</Table.Th>
                  <Table.Th>{t('sample.note')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.items.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>{e.queue_no}</Table.Td>
                    <Table.Td>{formatDate(`${e.day}T12:00:00+03:00`, lang, digits)}</Table.Td>
                    <Table.Td>
                      {nameOf({ name_ar: e.patient_name_ar, name_en: e.patient_name_en }, lang)} <Text span size="xs" c="dimmed">{e.patient_file_no}</Text>
                    </Table.Td>
                    <Table.Td>{nameOf(doctors.data?.find((d) => d.id === e.doctor_id), lang)}</Table.Td>
                    <Table.Td fz="sm">
                      {time(e.received_at)} <Text span size="xs" c="dimmed">{e.user_names.received_by}</Text>
                    </Table.Td>
                    <Table.Td fz="sm">{time(e.called_at)}</Table.Td>
                    <Table.Td fz="sm">{time(e.entered_at)}</Table.Td>
                    <Table.Td fz="sm">{time(e.exited_at)}</Table.Td>
                    <Table.Td>{t('queue.minutes', { n: e.waited_minutes })}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={e.stage === 'done' ? 'green' : e.stage === 'left' ? 'red' : 'blue'}>
                        {t(`queue.stages.${e.stage}`)}
                      </Badge>
                    </Table.Td>
                    <Table.Td fz="sm">{e.note}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </Stack>
  );
}

function Total({ label, value }: { label: string; value: string | number }) {
  return (
    <Card padding="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="xl">
        {value}
      </Text>
    </Card>
  );
}

