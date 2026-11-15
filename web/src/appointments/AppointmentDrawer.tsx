import {
  Alert,
  Anchor,
  Button,
  Combobox,
  Group,
  InputBase,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  useCombobox,
} from '@mantine/core';
import { DateInput, TimeInput } from '@mantine/dates';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconPrinter, IconUserPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { AppDrawer } from '../components/AppDrawer';
import { PhraseTextarea } from '../components/PhraseTextarea';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatTime, SAUDI_MOBILE } from '../lib/format';
import { nameOf, useDoctors, useServices, useStatuses, useVisitTypes } from '../master/queries';
import { useQuickSearch } from '../patients/queries';
import type { Patient } from '../patients/types';
import { hhmm, isoAt, localDate, minutesOf, parseHHMM, todayStr } from './time';
import type { Appointment, DraftAppointment } from './types';

interface Form {
  patient_id: number | null;
  patient_label: string;
  doctor_id: number | null;
  date: string;
  start: string; // HH:mm
  end: string; // HH:mm
  visit_type_id: number | null;
  service_id: number | null;
  status_id: number | null;
  is_waiting_list: boolean;
  note: string;
  exclude_sms: boolean;
  cancel_reason: string;
}

function fromAppointment(a: Appointment, lang: 'ar' | 'en'): Form {
  return {
    patient_id: a.patient_id,
    patient_label: a.patient ? `${nameOf(a.patient, lang)} · ${a.patient.file_no}` : '',
    doctor_id: a.doctor_id,
    date: localDate(a.starts_at),
    start: hhmm(minutesOf(a.starts_at)),
    end: hhmm(minutesOf(a.ends_at)),
    visit_type_id: a.visit_type_id,
    service_id: a.service_id,
    status_id: a.status_id,
    is_waiting_list: a.is_waiting_list,
    note: a.note,
    exclude_sms: a.exclude_sms,
    cancel_reason: a.cancel_reason ?? '',
  };
}

function fromDraft(d: DraftAppointment, defaultDuration: number): Form {
  const start = d.start ?? 9 * 60;
  return {
    patient_id: d.patient_id ?? null,
    patient_label: d.patient_label ?? '',
    doctor_id: d.doctor_id ?? null,
    date: d.date ?? todayStr(),
    start: hhmm(start),
    end: hhmm(start + (d.duration ?? defaultDuration)),
    visit_type_id: d.visit_type_id ?? null,
    service_id: d.service_id ?? null,
    status_id: null,
    is_waiting_list: false,
    note: d.note ?? '',
    exclude_sms: false,
    cancel_reason: '',
  };
}

/** Booking drawer (SPEC 6.3): new or edit. Opens prefilled from a calendar slot, a copy, or a patient. */
export function AppointmentDrawer({
  opened,
  appointment,
  draft,
  onClose,
  onSaved,
}: {
  opened: boolean;
  appointment?: Appointment | null;
  draft?: DraftAppointment | null;
  onClose: () => void;
  onSaved?: (a: Appointment) => void;
}) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const doctors = useDoctors();
  const statuses = useStatuses();
  const visitTypes = useVisitTypes();
  const services = useServices();
  const editing = !!appointment;
  const doctorSlot = (id: number | null) => doctors.data?.find((d) => d.id === id)?.slot_minutes ?? 15;
  const initial = useMemo<Form>(
    () => (appointment ? fromAppointment(appointment, lang) : fromDraft(draft ?? {}, doctorSlot(draft?.doctor_id ?? null))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointment, draft, opened],
  );
  const [form, setForm] = useState<Form>(initial);
  const [version, setVersion] = useState(appointment?.version ?? 0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, confirm] = useDisclosure(false);

  useEffect(() => {
    setForm(initial);
    setVersion(appointment?.version ?? 0);
    setError(null);
  }, [initial, appointment]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const statusById = (id: number | null) => statuses.data?.find((s) => s.id === id);
  const cancelling = statusById(form.status_id)?.key === 'cancelled' && form.status_id !== appointment?.status_id;
  const duration = parseHHMM(form.end) - parseHHMM(form.start);

  const setDuration = (mins: number) => set('end', hhmm(Math.min(parseHHMM(form.start) + mins, 24 * 60 - 1)));
  const setStart = (v: string) => {
    if (!/^\d{2}:\d{2}$/.test(v)) return set('start', v);
    const d = duration > 0 ? duration : doctorSlot(form.doctor_id);
    setForm((f) => ({ ...f, start: v, end: hhmm(Math.min(parseHHMM(v) + d, 24 * 60 - 1)) }));
  };

  async function save(ack: string[] = [], print = false) {
    if (!form.patient_id || !form.doctor_id || duration <= 0) return;
    if (cancelling && !form.cancel_reason.trim()) {
      setError(new ApiError(422, { code: 'cancel_reason_required' }));
      return;
    }
    setBusy(true);
    setError(null);
    const times = { starts_at: isoAt(form.date, parseHHMM(form.start)), ends_at: isoAt(form.date, parseHHMM(form.end)) };
    try {
      let saved: Appointment;
      if (!editing) {
        saved = await api<Appointment>('/appointments', {
          method: 'POST',
          body: {
            patient_id: form.patient_id,
            doctor_id: form.doctor_id,
            ...times,
            visit_type_id: form.visit_type_id,
            service_id: form.service_id,
            status_id: form.status_id,
            is_waiting_list: form.is_waiting_list,
            note: form.note,
            exclude_sms: form.exclude_sms,
            acknowledge: ack,
          },
        });
        if (draft?.waitingEntryId) await api(`/waiting-list/${draft.waitingEntryId}/resolve`, { method: 'POST' });
      } else {
        const a = appointment!;
        saved = a;
        const changed: Record<string, unknown> = {};
        if (form.doctor_id !== initial.doctor_id) changed.doctor_id = form.doctor_id;
        if (form.date !== initial.date || form.start !== initial.start || form.end !== initial.end) Object.assign(changed, times);
        for (const k of ['visit_type_id', 'service_id', 'is_waiting_list', 'note', 'exclude_sms'] as const) {
          if (form[k] !== initial[k]) changed[k] = form[k];
        }
        let v = version;
        if (Object.keys(changed).length) {
          saved = await api<Appointment>(`/appointments/${a.id}`, { method: 'PATCH', body: { version: v, ...changed, acknowledge: ack } });
          v = saved.version;
          setVersion(v);
        }
        if (form.status_id !== initial.status_id && form.status_id) {
          saved = await api<Appointment>(`/appointments/${a.id}/status`, {
            method: 'POST',
            body: { version: v, status_id: form.status_id, cancel_reason: cancelling ? form.cancel_reason : null },
          });
        }
      }
      await qc.invalidateQueries({ queryKey: ['appointments'] });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      onSaved?.(saved);
      onClose();
      if (print) window.open(`/print/slip/${saved.id}`, '_blank', 'noopener');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const warnings = error instanceof ApiError && error.code === 'needs_confirmation' ? (error.detail?.warnings as string[]) : null;
  const overlap = error instanceof ApiError && error.code === 'overlap' ? error.detail : null;
  const blockedOverride = warnings?.includes('outside_hours') && !can('appointment.override_hours');
  const requestClose = () => (dirty ? confirm.open() : onClose());
  const statusOptions = (statuses.data ?? []).map((s) => ({ value: String(s.id), label: nameOf(s, lang) }));
  const durations = [...new Set([doctorSlot(form.doctor_id), 15, 20, 30, 45, 60, 90, 120].filter((d) => d > 0))].sort((a, b) => a - b);

  return (
    <>
      <AppDrawer opened={opened} onClose={requestClose} title={editing ? t('appointments.edit') : t('topbar.newAppointment')} size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
          }}
          data-testid="appointment-form"
        >
          <Stack>
            {warnings && (
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} title={t('appointments.warningsTitle')} data-testid="appointment-warnings">
                <Stack gap="xs">
                  {warnings.map((w) => (
                    <Text size="sm" key={w}>
                      {t(`appointments.warnings.${w}`)}
                    </Text>
                  ))}
                  {blockedOverride ? (
                    <Text size="sm" fw={500}>
                      {t('appointments.needsOverride')}
                    </Text>
                  ) : (
                    <Button size="xs" color="yellow" w="fit-content" onClick={() => void save(warnings)} loading={busy} data-testid="continue-anyway">
                      {t('appointments.continueAnyway')}
                    </Button>
                  )}
                </Stack>
              </Alert>
            )}
            {overlap && (
              <Alert color="red" variant="light" data-testid="appointment-overlap">
                {t('appointments.overlapWith', {
                  name: (overlap.patient_name as string) ?? '',
                  from: formatTime(overlap.starts_at as string, lang, digits),
                  to: formatTime(overlap.ends_at as string, lang, digits),
                })}
              </Alert>
            )}
            {error !== null && !warnings && !overlap && (
              <Alert color="red" variant="light">
                {errorMessage(t, error, lang)}
              </Alert>
            )}

            <PatientPicker
              value={form.patient_id}
              label={form.patient_label}
              disabled={editing}
              onChange={(id, label) => setForm((f) => ({ ...f, patient_id: id, patient_label: label }))}
            />

            <SimpleGrid cols={2}>
              <Select
                label={t('appointments.doctor')}
                data={(doctors.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
                value={form.doctor_id ? String(form.doctor_id) : null}
                onChange={(v) => set('doctor_id', v ? Number(v) : null)}
                required
                searchable
                data-testid="appt-doctor"
              />
              <Select
                label={t('sample.visitType')}
                data={(visitTypes.data ?? []).map((v) => ({ value: String(v.id), label: nameOf(v, lang) }))}
                value={form.visit_type_id ? String(form.visit_type_id) : null}
                onChange={(v) => set('visit_type_id', v ? Number(v) : null)}
                clearable
              />
            </SimpleGrid>
            <Select
              label={t('appointments.service')}
              data={(services.data ?? []).map((s) => ({ value: String(s.id), label: `${s.code} · ${nameOf(s, lang)}` }))}
              value={form.service_id ? String(form.service_id) : null}
              onChange={(v) => set('service_id', v ? Number(v) : null)}
              clearable
              searchable
            />
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <DateInput
                label={t('sample.date')}
                valueFormat="DD/MM/YYYY"
                value={dayjs(form.date).toDate()}
                onChange={(d) => d && set('date', dayjs(d).format('YYYY-MM-DD'))}
                required
              />
              <TimeInput label={t('appointments.start')} value={form.start} onChange={(e) => setStart(e.currentTarget.value)} required data-testid="appt-start" />
              <Select
                label={t('appointments.duration')}
                data={durations.map((d) => ({ value: String(d), label: t('doctors.minutes', { n: d }) }))}
                value={durations.includes(duration) ? String(duration) : null}
                placeholder={duration > 0 ? t('doctors.minutes', { n: duration }) : undefined}
                onChange={(v) => v && setDuration(Number(v))}
              />
              <TimeInput label={t('appointments.end')} value={form.end} onChange={(e) => set('end', e.currentTarget.value)} required error={duration <= 0 ? ' ' : undefined} />
            </SimpleGrid>
            {editing && (
              <Select label={t('sample.status')} data={statusOptions} value={form.status_id ? String(form.status_id) : null} onChange={(v) => set('status_id', v ? Number(v) : null)} allowDeselect={false} data-testid="appt-status" />
            )}
            {cancelling && (
              <TextInput label={t('appointments.cancelReason')} value={form.cancel_reason} onChange={(e) => set('cancel_reason', e.currentTarget.value)} required data-autofocus />
            )}
            <PhraseTextarea fieldKey="appointment_note" label={t('sample.note')} value={form.note} onChange={(v) => set('note', v)} />
            <Group>
              <Switch label={t('appointments.waitingFlag')} description={t('appointments.waitingFlagHint')} checked={form.is_waiting_list} onChange={(e) => set('is_waiting_list', e.currentTarget.checked)} />
              <Switch label={t('sample.smsOptOut')} checked={form.exclude_sms} onChange={(e) => set('exclude_sms', e.currentTarget.checked)} />
            </Group>
            {appointment && (
              <Text size="xs" c="dimmed">
                {t('appointments.createdBy', { name: appointment.created_by_name ?? '—' })}
                {appointment.confirmed_by_name ? ` · ${t('appointments.confirmedBy', { name: appointment.confirmed_by_name })}` : ''}
              </Text>
            )}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button variant="light" leftSection={<IconPrinter size={16} />} onClick={() => void save([], true)} loading={busy} disabled={!form.patient_id || !form.doctor_id}>
                {t('appointments.saveAndPrint')}
              </Button>
              <Button type="submit" loading={busy} disabled={!form.patient_id || !form.doctor_id || duration <= 0 || (editing && !dirty)} data-testid="appt-save">
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

/** Patient search-as-you-type, or register a new patient with name and mobile only (SPEC 6.3). */
function PatientPicker({ value, label, disabled, onChange }: { value: number | null; label: string; disabled: boolean; onChange: (id: number | null, label: string) => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const combobox = useCombobox();
  const [search, setSearch] = useState(label);
  const [debounced] = useDebouncedValue(search, 150);
  const results = useQuickSearch(value ? '' : debounced, !value && !disabled);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => setSearch(label), [label]);

  async function create(allowDuplicate = false) {
    setError(null);
    try {
      const p = await api<Patient>('/patients', { method: 'POST', body: { name_ar: name.trim(), mobile: mobile.trim() || null, allow_duplicate: allowDuplicate } });
      onChange(p.id, `${nameOf(p, lang)} · ${p.file_no}`);
      setAdding(false);
    } catch (e) {
      setError(e);
    }
  }

  if (adding) {
    const dup = error instanceof ApiError && error.code === 'possible_duplicate' ? (error.detail?.matches as { id: number; file_no: number; name_ar: string; name_en: string }[]) : null;
    return (
      <Stack gap="xs" p="sm" style={{ border: '1px solid var(--app-border)', borderRadius: 'var(--mantine-radius-md)' }} data-testid="inline-new-patient">
        <Text size="sm" fw={600}>
          {t('patients.new')}
        </Text>
        <SimpleGrid cols={2}>
          <TextInput label={t('patients.fields.name_ar')} value={name} onChange={(e) => setName(e.currentTarget.value)} required name="new_name" />
          <TextInput label={t('patients.fields.mobile')} value={mobile} onChange={(e) => setMobile(e.currentTarget.value)} placeholder="05XXXXXXXX" dir="ltr" error={mobile && !SAUDI_MOBILE.test(mobile.trim()) ? t('sample.mobileInvalid') : undefined} name="new_mobile" />
        </SimpleGrid>
        {dup ? (
          <Alert color="yellow" variant="light" p="xs">
            <Stack gap={4}>
              <Text size="sm">{t('patients.duplicateTitle')}</Text>
              {dup.map((d) => (
                <Anchor key={d.id} size="sm" onClick={() => { onChange(d.id, `${nameOf(d, lang)} · ${d.file_no}`); setAdding(false); }}>
                  {t('appointments.useExisting', { name: nameOf(d, lang), no: d.file_no })}
                </Anchor>
              ))}
              <Anchor size="sm" onClick={() => void create(true)}>
                {t('patients.createAnyway')}
              </Anchor>
            </Stack>
          </Alert>
        ) : (
          error !== null && <Text size="sm" c="red">{errorMessage(t, error, lang)}</Text>
        )}
        <Group gap="xs">
          <Button size="xs" onClick={() => void create()} disabled={name.trim().length < 2 || (!!mobile && !SAUDI_MOBILE.test(mobile.trim()))}>
            {t('appointments.addPatient')}
          </Button>
          <Button size="xs" variant="default" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(v) => {
        const p = results.data?.find((x) => String(x.id) === v);
        if (p) {
          const l = `${nameOf(p, lang)} · ${p.file_no}`;
          onChange(p.id, l);
          setSearch(l);
        }
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <InputBase
          label={t('appointments.patient')}
          required
          disabled={disabled}
          value={search}
          placeholder={t('patients.searchHint')}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            if (value) onChange(null, '');
            combobox.openDropdown();
          }}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
          rightSection={results.isFetching ? <Loader size={14} /> : null}
          data-testid="appt-patient"
        />
      </Combobox.Target>
      <Combobox.Dropdown hidden={!!value || disabled}>
        <Combobox.Options>
          {(results.data ?? []).map((p) => (
            <Combobox.Option value={String(p.id)} key={p.id}>
              <Text size="sm">
                {nameOf(p, lang)} · {p.file_no}
              </Text>
              <Text size="xs" c="dimmed" dir="ltr" ta="start">
                {p.mobile}
              </Text>
            </Combobox.Option>
          ))}
          {debounced && results.data?.length === 0 && <Combobox.Empty>{t('patients.noMatch')}</Combobox.Empty>}
        </Combobox.Options>
        {can('patient.create') && (
          <Combobox.Footer>
            <Anchor
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setName(/\d/.test(search) ? '' : search);
                setMobile(/^0?5\d*$/.test(search.trim()) ? search.trim() : '');
                setAdding(true);
                combobox.closeDropdown();
              }}
              data-testid="inline-new-patient-link"
            >
              <Group gap={4}>
                <IconUserPlus size={14} />
                {t('appointments.newPatientInline')}
              </Group>
            </Anchor>
          </Combobox.Footer>
        )}
      </Combobox.Dropdown>
    </Combobox>
  );
}

