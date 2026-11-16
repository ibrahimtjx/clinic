import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Menu,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCalendarPlus, IconCheck, IconLock, IconMapPin, IconPlus, IconPrinter, IconSearch } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { PhraseTextarea } from '../components/PhraseTextarea';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime } from '../lib/format';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { nameOf, useDepartments, useDoctors } from '../master/queries';
import type { PhraseField } from '../master/types';
import type { Patient } from '../patients/types';
import { CATEGORY_COLORS, ToothChart, type Dentition } from './ToothChart';
import { TEXT_FIELDS, type DentalRecord, type DentalVisit, type TextField } from './types';
import { printDoc } from '../lib/print';

const PHRASE_KEYS: Partial<Record<TextField, PhraseField>> = {
  chief_complaint: 'chief_complaint',
  diagnosis: 'diagnosis',
  procedure: 'procedure',
  preventive_advice: 'preventive_advice',
  complications: 'complications',
  patient_education: 'patient_education',
  next_visit: 'next_visit',
};

type Form = Record<TextField, string> & { department_id: number | null; doctor_id: number | null; icd10: string };

const emptyForm = (doctorId: number | null, departmentId: number | null): Form => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((f) => [f, ''])) as Record<TextField, string>),
  doctor_id: doctorId,
  department_id: departmentId,
  icd10: '',
});

const fromVisit = (v: DentalVisit): Form => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((f) => [f, v[f]])) as Record<TextField, string>),
  doctor_id: v.doctor_id,
  department_id: v.department_id,
  icd10: v.icd10 ?? '',
});

/** Dental tab (SPEC 8): tooth chart on top, visit history on the side, visit form in the main area. */
export function DentalTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const doctors = useDoctors();
  const departments = useDepartments();
  const myDoctor = doctors.data?.find((d) => d.user_id === me?.id);
  const [filters, setFilters] = useState<{ department_id?: number; tooth?: number; q?: string }>({});
  // Debounced: every load of the record is a logged read, so not one per keystroke.
  const [debouncedFilters] = useDebouncedValue(filters, 400);
  // Every load of the dental record is a logged read (SPEC 3.4): never served from cache.
  const rec = useQuery({
    queryKey: ['dental', patient.id, debouncedFilters],
    queryFn: () => api<DentalRecord>(`/patients/${patient.id}/dental`, { query: debouncedFilters }),
    gcTime: 0,
  });
  const [dentition, setDentition] = useState<Dentition>(() => (patientAge(patient) < 13 ? 'mixed' : 'permanent'));
  const [selectedVisitId, setSelectedVisitId] = useState<number | null>(null);
  const visits = rec.data?.visits ?? [];
  const current = visits.find((v) => v.id === selectedVisitId) ?? null;
  const [teeth, setTeeth] = useState<number[]>([]);
  const [form, setForm] = useState<Form>(emptyForm(null, null));
  const [base, setBase] = useState<string>('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [addendum, setAddendum] = useState('');

  const newVisit = () => {
    const f = emptyForm(myDoctor?.id ?? patient.default_doctor_id ?? null, myDoctor?.department_id ?? null);
    setSelectedVisitId(null);
    setForm(f);
    setTeeth([]);
    setBase(JSON.stringify([f, []]));
    setError(null);
  };
  useEffect(() => {
    if (!base && doctors.data) newVisit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctors.data]);

  const openVisit = (v: DentalVisit) => {
    const f = fromVisit(v);
    setSelectedVisitId(v.id);
    setForm(f);
    setTeeth(v.teeth);
    setBase(JSON.stringify([f, v.teeth]));
    setError(null);
    setAddendum('');
  };

  const readOnly = !can('dental.edit') || (current !== null && !current.can_edit);
  const dirty = !readOnly && JSON.stringify([form, teeth]) !== base;

  async function save(print = false): Promise<boolean> {
    if (!form.doctor_id) return false;
    setBusy(true);
    setError(null);
    const body = { ...form, icd10: form.icd10.trim() || null, teeth };
    try {
      let saved: DentalVisit;
      if (current) {
        const { doctor_id: _d, ...patch } = body;
        saved = await api<DentalVisit>(`/dental-visits/${current.id}`, { method: 'PATCH', body: { version: current.version, ...patch } });
      } else {
        saved = await api<DentalVisit>(`/patients/${patient.id}/dental/visits`, { method: 'POST', body });
      }
      await qc.invalidateQueries({ queryKey: ['dental', patient.id] });
      openVisit(saved);
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      if (print) void printDoc(`/print/dental/${patient.id}?visit=${saved.id}`);
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const guard = useUnsavedGuard(dirty, () => save());

  async function addFinding(category: string) {
    try {
      for (const tooth of teeth) {
        await api(`/patients/${patient.id}/dental/findings`, { method: 'POST', body: { tooth_fdi: tooth, category, visit_id: current?.id ?? null } });
      }
      await qc.invalidateQueries({ queryKey: ['dental', patient.id] });
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
    }
  }

  async function saveAddendum() {
    if (!current || !addendum.trim()) return;
    try {
      const v = await api<DentalVisit>(`/dental-visits/${current.id}/addenda`, { method: 'POST', body: { text: addendum } });
      setAddendum('');
      qc.setQueryData<DentalRecord>(['dental', patient.id, debouncedFilters], (r) => (r ? { ...r, visits: r.visits.map((x) => (x.id === v.id ? v : x)) } : r));
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
    }
  }

  const departmentName = (id: number | null) => nameOf(departments.data?.find((d) => d.id === id), lang);
  const doctorName = (id: number | null) => nameOf(doctors.data?.find((d) => d.id === id), lang);
  const summary = (v: DentalVisit) => v.procedure || v.diagnosis || v.chief_complaint || v.note || '—';
  const locked = current && !current.can_edit;
  const findingsForChart = useMemo(() => rec.data?.findings ?? [], [rec.data]);

  if (rec.isPending) return <Skeleton height={400} radius="md" />;
  if (rec.isError) return <Alert color="red">{errorMessage(t, rec.error, lang)}</Alert>;

  return (
    <Stack data-testid="dental-tab">
      {guard}
      <Card>
        <ToothChart
          selected={teeth}
          onToggle={readOnly ? undefined : (n) => setTeeth((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].sort((a, b) => a - b)))}
          findings={findingsForChart}
          visits={visits}
          dentition={dentition}
          onDentition={setDentition}
        />
        <Group justify="center" mt="xs" gap="xs">
          <Text size="sm" c="dimmed" data-testid="selected-teeth">
            {teeth.length ? `${t('dental.selected')}: ${teeth.join('، ')}` : t('dental.selectHint')}
          </Text>
          {can('dental.edit') && teeth.length > 0 && (
            <Menu>
              <Menu.Target>
                <Button size="compact-xs" variant="light" leftSection={<IconMapPin size={12} />} data-testid="mark-teeth">
                  {t('dental.mark')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {Object.keys(CATEGORY_COLORS).map((c) => (
                  <Menu.Item key={c} onClick={() => void addFinding(c)} data-testid={`mark-${c}`}>
                    {t(`dental.categories.${c}`)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Card>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card padding="sm">
            <Group justify="space-between" mb="xs">
              <Text fw={600}>{t('dental.history')}</Text>
              <Group gap={4}>
                <Button size="compact-xs" variant="subtle" leftSection={<IconPrinter size={12} />} onClick={() => void printDoc(`/print/dental/${patient.id}`)}>
                  {t('dental.printHistory')}
                </Button>
                {can('dental.edit') && (
                  <Button size="compact-xs" leftSection={<IconPlus size={12} />} onClick={newVisit} data-testid="new-visit">
                    {t('dental.newVisit')}
                  </Button>
                )}
              </Group>
            </Group>
            <Stack gap={6} mb="xs">
              <TextInput size="xs" leftSection={<IconSearch size={12} />} placeholder={t('common.search')} value={filters.q ?? ''} onChange={(e) => setFilters({ ...filters, q: e.currentTarget.value || undefined })} />
              <Group grow gap={6}>
                <Select size="xs" placeholder={t('services.department')} data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))} value={filters.department_id ? String(filters.department_id) : null} onChange={(v) => setFilters({ ...filters, department_id: v ? Number(v) : undefined })} clearable />
                <TextInput size="xs" placeholder={t('dental.tooth')} value={filters.tooth ? String(filters.tooth) : ''} onChange={(e) => setFilters({ ...filters, tooth: Number(e.currentTarget.value) || undefined })} dir="ltr" />
              </Group>
            </Stack>
            <ScrollArea.Autosize mah={520}>
              <Stack gap={4}>
                {visits.length === 0 && (
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    {t('dental.noVisits')}
                  </Text>
                )}
                {visits.map((v) => (
                  <UnstyledButton
                    key={v.id}
                    onClick={() => openVisit(v)}
                    p="xs"
                    style={{ borderRadius: 'var(--mantine-radius-md)', background: v.id === selectedVisitId ? 'var(--app-nav-active-bg)' : undefined }}
                    data-testid={`visit-${v.id}`}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Text size="sm" fw={500}>
                        {formatDate(v.visit_at, lang, digits)}
                      </Text>
                      {!v.can_edit && <IconLock size={12} color="var(--app-muted)" />}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {departmentName(v.department_id) || '—'} · {doctorName(v.doctor_id)}
                      {v.teeth.length ? ` · ${v.teeth.join('، ')}` : ''}
                    </Text>
                    <Text size="xs" lineClamp={1}>
                      {summary(v)}
                    </Text>
                  </UnstyledButton>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !readOnly) void save();
              }}
              data-testid="visit-form"
            >
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600}>{current ? `${t('dental.visit')} · ${formatDateTime(current.visit_at, lang, digits)}` : t('dental.newVisit')}</Text>
                  {current && (
                    <Text size="xs" c="dimmed">
                      {current.created_by_name}
                      {current.can_edit && current.editable_until ? ` · ${t('dental.editableUntil', { time: formatDateTime(current.editable_until, lang, digits) })}` : ''}
                    </Text>
                  )}
                </Group>
                {locked && (
                  <Alert color="neutral" variant="light" icon={<IconLock size={16} />} data-testid="visit-locked">
                    {t('dental.lockedHint', { hours: rec.data.edit_hours })}
                  </Alert>
                )}
                {error !== null && (
                  <Alert color="red" variant="light">
                    {error instanceof ApiError && error.code === 'visit_locked' ? t('dental.lockedHint', { hours: rec.data.edit_hours }) : errorMessage(t, error, lang)}
                  </Alert>
                )}
                <Grid gutter="sm">
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <Select
                      label={t('appointments.doctor')}
                      data={(doctors.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
                      value={form.doctor_id ? String(form.doctor_id) : null}
                      onChange={(v) => setForm({ ...form, doctor_id: v ? Number(v) : null })}
                      disabled={readOnly || !!current || !!myDoctor}
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <Select
                      label={t('services.department')}
                      data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
                      value={form.department_id ? String(form.department_id) : null}
                      onChange={(v) => setForm({ ...form, department_id: v ? Number(v) : null })}
                      disabled={readOnly}
                      clearable
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <TextInput label={t('dental.icd10')} value={form.icd10} onChange={(e) => setForm({ ...form, icd10: e.currentTarget.value.toUpperCase() })} disabled={readOnly} dir="ltr" placeholder="K02.1" />
                  </Grid.Col>
                </Grid>
                <Text size="sm">
                  {t('dental.teeth')}:{' '}
                  {teeth.length ? (
                    teeth.map((n) => (
                      <Badge key={n} size="sm" variant="light" me={4}>
                        {n}
                      </Badge>
                    ))
                  ) : (
                    <Text span c="dimmed" size="sm">
                      {t('dental.selectHint')}
                    </Text>
                  )}
                </Text>
                {TEXT_FIELDS.map((f) =>
                  PHRASE_KEYS[f] && !readOnly ? (
                    <PhraseTextarea key={f} fieldKey={PHRASE_KEYS[f]} label={t(`dental.fields.${f}`)} value={form[f]} onChange={(v) => setForm({ ...form, [f]: v })} minRows={f === 'next_visit' ? 1 : 2} name={f} />
                  ) : (
                    <Textarea key={f} label={t(`dental.fields.${f}`)} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.currentTarget.value })} autosize minRows={1} readOnly={readOnly} name={f} />
                  ),
                )}
                {can('appointment.create') && (
                  <Group>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconCalendarPlus size={14} />}
                      onClick={() => navigate(`/appointments?new=1&patient=${patient.id}&label=${encodeURIComponent(`${nameOf(patient, lang)} · ${patient.file_no}`)}`)}
                    >
                      {t('dental.bookNow')}
                    </Button>
                    <Text size="xs" c="dimmed">
                      {t('dental.planLater')}
                    </Text>
                  </Group>
                )}
                {!readOnly && (
                  <Group justify="flex-end">
                    <Button variant="default" onClick={newVisit}>
                      {t('dental.newVisit')}
                    </Button>
                    <Button variant="light" leftSection={<IconPrinter size={16} />} onClick={() => void save(true)} loading={busy}>
                      {t('dental.saveAndPrint')}
                    </Button>
                    <Button type="submit" loading={busy} disabled={!dirty || !form.doctor_id} data-testid="save-visit">
                      {t('common.save')}
                    </Button>
                  </Group>
                )}
                {current && (
                  <Stack gap={6} mt="sm" data-testid="addenda">
                    <Text fw={600} size="sm">
                      {t('dental.addenda')}
                    </Text>
                    {current.addenda.length === 0 && (
                      <Text size="xs" c="dimmed">
                        {t('dental.noAddenda')}
                      </Text>
                    )}
                    {current.addenda.map((a) => (
                      <Card key={a.id} padding="xs" withBorder>
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                          {a.text}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {a.created_by_name} · {formatDateTime(a.created_at, lang, digits)}
                        </Text>
                      </Card>
                    ))}
                    {can('dental.edit') && (
                      <Group align="flex-end" gap="xs">
                        <Textarea flex={1} label={t('dental.addAddendum')} value={addendum} onChange={(e) => setAddendum(e.currentTarget.value)} autosize minRows={1} data-testid="addendum-text" />
                        <Button onClick={() => void saveAddendum()} disabled={!addendum.trim()} data-testid="addendum-save">
                          {t('common.save')}
                        </Button>
                      </Group>
                    )}
                  </Stack>
                )}
              </Stack>
            </form>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function patientAge(p: Patient): number {
  if (!p.dob) return 99;
  return (Date.now() - new Date(p.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
}
