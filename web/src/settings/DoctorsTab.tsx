import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  ColorSwatch,
  Divider,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck, IconCopy, IconPencil, IconPlus, IconStethoscope, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { displayName, useAuth } from '../auth/AuthProvider';
import type { User } from '../auth/types';
import { AppDrawer } from '../components/AppDrawer';
import { ColorSelect } from '../components/ColorSelect';
import { EmptyState } from '../components/EmptyState';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { nameOf, useClinics, useDepartments, useDoctors, useServices } from '../master/queries';
import type { ColorName, CommissionRule, Doctor, ScheduleItem } from '../master/types';

type Form = Omit<Doctor, 'id' | 'sort_order' | 'version' | 'updated_at' | 'deleted_at' | 'commission_rules'> & {
  commission_rules: CommissionRule[];
};

const EMPTY: Form = {
  user_id: null,
  name_ar: '',
  name_en: '',
  specialty_ar: '',
  specialty_en: '',
  clinic_id: null,
  department_id: null,
  color: 'blue',
  slot_minutes: 15,
  is_active: true,
  schedules: [],
  commission_rules: [],
};

const hhmm = (t: string) => t.slice(0, 5);

/** Doctors (SPEC 12): schedule per weekday with breaks, slot length, calendar color, commission. */
export function DoctorsTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const doctors = useDoctors({ includeInactive: true });
  const departments = useDepartments({ includeInactive: true });
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);
  const days = t('weekdays', { returnObjects: true }) as string[];

  return (
    <Card padding={0}>
      <Group justify="space-between" p="md">
        <div>
          <Text fw={600}>{t('settings.tabs.doctors')}</Text>
          <Text size="sm" c="dimmed">
            {t('doctors.hint')}
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')} data-testid="new-doctor">
          {t('doctors.new')}
        </Button>
      </Group>
      {doctors.isPending ? (
        <Stack p="md">
          <Skeleton height={28} />
          <Skeleton height={28} />
        </Stack>
      ) : doctors.isError ? (
        <Alert m="md" color="red" variant="light">
          {errorMessage(t, doctors.error, lang)}
        </Alert>
      ) : doctors.data.length === 0 ? (
        <EmptyState
          icon={IconStethoscope}
          title={t('doctors.emptyTitle')}
          hint={t('doctors.emptyHint')}
          action={
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
              {t('doctors.new')}
            </Button>
          }
        />
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table data-testid="doctors-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('master.name')}</Table.Th>
                <Table.Th>{t('doctors.specialty')}</Table.Th>
                <Table.Th>{t('services.department')}</Table.Th>
                <Table.Th>{t('doctors.workingDays')}</Table.Th>
                <Table.Th>{t('doctors.slot')}</Table.Th>
                <Table.Th>{t('users.status')}</Table.Th>
                <Table.Th w={48} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {doctors.data.map((d) => {
                const workDays = [...new Set(d.schedules.filter((s) => s.kind === 'work').map((s) => s.weekday))].sort();
                return (
                  <Table.Tr key={d.id}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <ColorSwatch color={`var(--mantine-color-${d.color}-filled)`} size={12} />
                        <Text size="sm" fw={500}>
                          {nameOf(d, lang)}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>{(lang === 'ar' ? d.specialty_ar : d.specialty_en) || '—'}</Table.Td>
                    <Table.Td>{nameOf(departments.data?.find((x) => x.id === d.department_id), lang) || '—'}</Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {workDays.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            {t('doctors.noSchedule')}
                          </Text>
                        ) : (
                          workDays.map((w) => (
                            <Badge key={w} size="sm" color="accent" variant="light">
                              {days[w].slice(0, lang === 'ar' ? 10 : 3)}
                            </Badge>
                          ))
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{t('doctors.minutes', { n: d.slot_minutes })}</Table.Td>
                    <Table.Td>{d.is_active ? <Badge color="green">{t('users.active')}</Badge> : <Badge color="neutral">{t('users.inactive')}</Badge>}</Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="neutral" onClick={() => setEditing(d)} aria-label={t('common.edit')}>
                        <IconPencil size={18} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <DoctorDrawer item={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function DoctorDrawer({ item, onClose }: { item: Doctor | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const clinics = useClinics();
  const departments = useDepartments();
  const services = useServices();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users'), enabled: can('user.manage') && item !== null });
  const isNew = item === 'new';
  const initial = useMemo<Form>(() => {
    if (!item || item === 'new') return { ...EMPTY, clinic_id: clinics.data?.[0]?.id ?? null };
    const { id: _i, sort_order: _s, version: _v, updated_at: _u, deleted_at: _d, ...rest } = item;
    return {
      ...rest,
      schedules: item.schedules.map(({ weekday, start_time, end_time, kind }) => ({ weekday, start_time: hhmm(start_time), end_time: hhmm(end_time), kind })),
      commission_rules: (item.commission_rules ?? []).map(({ department_id, service_id, percent }) => ({ department_id, service_id, percent })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  const [form, setForm] = useState<Form>(initial);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, confirm] = useDisclosure(false);

  useEffect(() => {
    setForm(initial);
    setVersion(item && item !== 'new' ? item.version : 0);
    setError(null);
  }, [initial, item]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const canCommission = item === 'new' || (item !== null && item.commission_rules !== null);

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { ...form };
    if (!canCommission) delete body.commission_rules;
    try {
      if (isNew) await api('/doctors', { method: 'POST', body });
      else if (item) await api(`/doctors/${item.id}`, { method: 'PATCH', body: { version, ...body } });
      await qc.invalidateQueries({ queryKey: ['master', 'doctors'] });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const requestClose = () => (dirty ? confirm.open() : onClose());
  const stale = error instanceof ApiError && error.code === 'stale_record';
  const doctorUsers = (users.data ?? []).filter((u) => u.is_active && u.roles.some((r) => r.key === 'doctor'));

  return (
    <>
      <AppDrawer opened={item !== null} onClose={requestClose} title={isNew ? t('doctors.new') : t('doctors.edit')} size="xl">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
          }}
          data-testid="doctor-form"
        >
          <Stack>
            {error !== null && (
              <Alert color={stale ? 'yellow' : 'red'} variant="light" icon={<IconAlertCircle size={18} />}>
                {errorMessage(t, error, lang)}
              </Alert>
            )}
            <SimpleGrid cols={2}>
              <TextInput label={t('users.nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.currentTarget.value)} required />
              <TextInput label={t('users.nameEn')} value={form.name_en} onChange={(e) => set('name_en', e.currentTarget.value)} dir="ltr" />
              <TextInput label={t('doctors.specialtyAr')} value={form.specialty_ar} onChange={(e) => set('specialty_ar', e.currentTarget.value)} />
              <TextInput label={t('doctors.specialtyEn')} value={form.specialty_en} onChange={(e) => set('specialty_en', e.currentTarget.value)} dir="ltr" />
              <Select
                label={t('master.clinic')}
                data={(clinics.data ?? []).map((c) => ({ value: String(c.id), label: nameOf(c, lang) }))}
                value={form.clinic_id == null ? null : String(form.clinic_id)}
                onChange={(v) => set('clinic_id', v ? Number(v) : null)}
                clearable
              />
              <Select
                label={t('services.department')}
                data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
                value={form.department_id == null ? null : String(form.department_id)}
                onChange={(v) => set('department_id', v ? Number(v) : null)}
                clearable
              />
              <ColorSelect label={t('doctors.calendarColor')} value={form.color} onChange={(c: ColorName) => set('color', c)} />
              <NumberInput
                label={t('doctors.slot')}
                description={t('doctors.slotHint')}
                value={form.slot_minutes}
                onChange={(v) => set('slot_minutes', Number(v) || 15)}
                min={5}
                max={240}
                step={5}
                allowDecimal={false}
              />
            </SimpleGrid>
            <Select
              label={t('doctors.userAccount')}
              description={can('user.manage') ? t('doctors.userAccountHint') : t('doctors.userAccountNoAccess')}
              data={doctorUsers.map((u) => ({ value: String(u.id), label: `${displayName(u, lang)} (${u.username})` }))}
              value={form.user_id == null ? null : String(form.user_id)}
              onChange={(v) => set('user_id', v ? Number(v) : null)}
              clearable
              disabled={!can('user.manage')}
            />
            <Switch label={t('users.active')} checked={form.is_active} onChange={(e) => set('is_active', e.currentTarget.checked)} />

            <Divider my="xs" />
            <ScheduleEditor value={form.schedules} onChange={(s) => set('schedules', s)} />

            {canCommission && (
              <>
                <Divider my="xs" />
                <CommissionEditor
                  value={form.commission_rules}
                  onChange={(r) => set('commission_rules', r)}
                  departments={(departments.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
                  services={(services.data ?? []).map((s) => ({ value: String(s.id), label: `${s.code} · ${nameOf(s, lang)}` }))}
                />
              </>
            )}

            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={busy} disabled={!isNew && !dirty}>
                {t('common.save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </AppDrawer>
      <UnsavedChangesModal
        opened={confirmOpen}
        onKeepEditing={confirm.close}
        onDiscard={() => {
          confirm.close();
          onClose();
        }}
        onSave={() => {
          confirm.close();
          void save();
        }}
      />
    </>
  );
}

/** Weekly working hours and breaks (weekday 0 = Sunday). */
export function ScheduleEditor({ value, onChange }: { value: ScheduleItem[]; onChange: (v: ScheduleItem[]) => void }) {
  const { t } = useTranslation();
  const days = t('weekdays', { returnObjects: true }) as string[];
  const update = (i: number, patch: Partial<ScheduleItem>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = (weekday: number, kind: 'work' | 'break') => {
    const work = value.filter((s) => s.weekday === weekday && s.kind === 'work');
    const last = work[work.length - 1];
    const item: ScheduleItem =
      kind === 'work'
        ? last
          ? { weekday, kind, start_time: '16:00', end_time: '21:00' }
          : { weekday, kind, start_time: '09:00', end_time: '13:00' }
        : { weekday, kind, start_time: '11:00', end_time: '11:30' };
    onChange([...value, item]);
  };
  /** Replace the hours of every other working day with this day's periods and breaks. */
  const copyToAll = (weekday: number) => {
    const src = value.filter((s) => s.weekday === weekday);
    const working = new Set(value.filter((s) => s.kind === 'work').map((s) => s.weekday));
    const out = value.filter((s) => !working.has(s.weekday) || s.weekday === weekday);
    for (const d of working) if (d !== weekday) out.push(...src.map((s) => ({ ...s, weekday: d })));
    onChange(out.sort(byDayTime));
  };

  return (
    <Stack gap="xs" data-testid="schedule-editor">
      <Title order={4}>{t('doctors.schedule')}</Title>
      <Text size="xs" c="dimmed">
        {t('doctors.scheduleHint')}
      </Text>
      {days.map((label, weekday) => {
        const items = value.map((s, i) => ({ s, i })).filter(({ s }) => s.weekday === weekday);
        const working = items.some(({ s }) => s.kind === 'work');
        return (
          <Card key={weekday} padding="sm" withBorder shadow="none" bg={working ? undefined : 'var(--app-bg)'}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Switch
                label={label}
                checked={working}
                onChange={(e) => (e.currentTarget.checked ? add(weekday, 'work') : onChange(value.filter((s) => s.weekday !== weekday)))}
                w={150}
                data-testid={`day-${weekday}`}
              />
              <Stack gap={6} flex={1}>
                {items.map(({ s, i }) => (
                  <Group key={i} gap="xs" wrap="nowrap">
                    <Badge w={64} color={s.kind === 'work' ? 'accent' : 'yellow'} variant="light">
                      {t(`doctors.${s.kind}`)}
                    </Badge>
                    <TimeInput value={s.start_time} onChange={(e) => update(i, { start_time: e.currentTarget.value })} size="xs" w={120} aria-label={t('doctors.from')} />
                    <Text size="xs">–</Text>
                    <TimeInput value={s.end_time} onChange={(e) => update(i, { end_time: e.currentTarget.value })} size="xs" w={120} aria-label={t('doctors.to')} />
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove(i)} aria-label={t('common.delete')}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                ))}
                {working && (
                  <Group gap="xs">
                    <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => add(weekday, 'work')}>
                      {t('doctors.addPeriod')}
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="yellow" leftSection={<IconPlus size={12} />} onClick={() => add(weekday, 'break')}>
                      {t('doctors.addBreak')}
                    </Button>
                    <Tooltip label={t('doctors.copyHint')}>
                      <Button size="compact-xs" variant="subtle" color="neutral" leftSection={<IconCopy size={12} />} onClick={() => copyToAll(weekday)}>
                        {t('doctors.copyToAll')}
                      </Button>
                    </Tooltip>
                  </Group>
                )}
              </Stack>
            </Group>
          </Card>
        );
      })}
    </Stack>
  );
}

const byDayTime = (a: ScheduleItem, b: ScheduleItem) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time);

function CommissionEditor({
  value,
  onChange,
  departments,
  services,
}: {
  value: CommissionRule[];
  onChange: (v: CommissionRule[]) => void;
  departments: { value: string; label: string }[];
  services: { value: string; label: string }[];
}) {
  const { t } = useTranslation();
  const scopeOf = (r: CommissionRule) => (r.service_id != null ? 'service' : r.department_id != null ? 'department' : 'default');
  const update = (i: number, patch: Partial<CommissionRule>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Stack gap="xs">
      <Title order={4}>{t('doctors.commission')}</Title>
      <Text size="xs" c="dimmed">
        {t('doctors.commissionHint')}
      </Text>
      {value.map((r, i) => (
        <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
          <Select
            label={i === 0 ? t('doctors.scope') : undefined}
            data={[
              { value: 'default', label: t('doctors.scopeDefault') },
              { value: 'department', label: t('services.department') },
              { value: 'service', label: t('doctors.service') },
            ]}
            value={scopeOf(r)}
            onChange={(v) => update(i, { department_id: v === 'department' ? Number(departments[0]?.value) || null : null, service_id: v === 'service' ? Number(services[0]?.value) || null : null })}
            w={140}
            allowDeselect={false}
          />
          {scopeOf(r) === 'department' && (
            <Select data={departments} value={String(r.department_id)} onChange={(v) => update(i, { department_id: Number(v) })} flex={1} searchable allowDeselect={false} />
          )}
          {scopeOf(r) === 'service' && (
            <Select data={services} value={String(r.service_id)} onChange={(v) => update(i, { service_id: Number(v) })} flex={1} searchable allowDeselect={false} />
          )}
          {scopeOf(r) === 'default' && <div style={{ flex: 1 }} />}
          <NumberInput
            label={i === 0 ? '%' : undefined}
            value={r.percent}
            onChange={(v) => update(i, { percent: String(v === '' ? '0' : v) })}
            min={0}
            max={100}
            decimalScale={2}
            w={100}
            dir="ltr"
            hideControls
          />
          <ActionIcon variant="subtle" color="red" mb={4} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Button
        size="xs"
        variant="light"
        w="fit-content"
        leftSection={<IconPlus size={14} />}
        onClick={() => onChange([...value, { department_id: null, service_id: null, percent: '0' }])}
      >
        {t('doctors.addRule')}
      </Button>
    </Stack>
  );
}
