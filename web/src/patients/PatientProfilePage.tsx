import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconCalendarPlus,
  IconCash,
  IconCheck,
  IconChevronDown,
  IconDental,
  IconDots,
  IconFileInvoice,
  IconFiles,
  IconHeartbeat,
  IconHistory,
  IconId,
  IconLayoutDashboard,
  IconMessage,
  IconPhone,
  IconPrinter,
  IconReceipt,
  IconRestore,
  IconSend,
  IconShieldCheck,
  IconTrash,
  IconUserCheck,
  IconUserOff,
  IconUserShare,
  IconClipboardList,
  IconCalendarEvent,
  IconPill,
  type Icon,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import type { AuditRow } from '../auth/types';
import { EmptyState } from '../components/EmptyState';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { ageParts, formatDate, formatDateTime, formatMoney } from '../lib/format';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { nameOf, useDoctors } from '../master/queries';
import { PatientAppointments, UpcomingCard } from '../appointments/PatientAppointments';
import { PatientBillingTab } from '../billing/BillingPage';
import { PlansTab } from '../billing/PlansTab';
import { ClinicalTab } from '../clinical/ClinicalTab';
import { FilesTab } from '../clinical/FilesTab';
import { DentalTab } from '../dental/DentalTab';
import { SendToDoctorModal, type SendTarget } from '../queue/SendToDoctorModal';
import { DuplicateAlert, PatientFields, toBody, toForm, useDuplicates, validate, type PatientFormValues } from './PatientForm';
import { patientKeys, usePatient } from './queries';
import type { Assignment, Health, Patient } from './types';

interface TabDef {
  key: string;
  icon: Icon;
  milestone?: string;
  perm?: string;
}

const TABS: TabDef[] = [
  { key: 'overview', icon: IconLayoutDashboard },
  { key: 'personal', icon: IconId },
  { key: 'health', icon: IconHeartbeat, perm: 'patient.medical_view' },
  { key: 'dental', icon: IconDental, perm: 'dental.view' },
  { key: 'plans', icon: IconClipboardList, perm: 'plan.view' },
  { key: 'appointments', icon: IconCalendarEvent, perm: 'appointment.view' },
  { key: 'billing', icon: IconReceipt },
  { key: 'files', icon: IconFiles, perm: 'file.view' },
  { key: 'prescriptions', icon: IconPill, perm: 'dental.view' },
  { key: 'activity', icon: IconHistory, perm: 'audit.view' },
];

/** Patient profile (SPEC 5.2): header card, action bar, one page with tabs. */
export function PatientProfilePage() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const { id, tab } = useParams();
  const navigate = useNavigate();
  const patientId = Number(id);
  const q = usePatient(patientId);
  const tabs = TABS.filter((x) => !x.perm || can(x.perm));

  if (!tab) return <Navigate to={`/patients/${patientId}/overview`} replace />;
  if (q.isPending) return <Skeleton height={180} radius="md" />;
  if (q.isError) {
    return (
      <Alert color="red" variant="light">
        {errorMessage(t, q.error, lang)}
      </Alert>
    );
  }
  const p = q.data;

  return (
    <Stack gap="md" maw={1300}>
      <HeaderCard patient={p} />
      <ActionBar patient={p} />
      <Tabs value={tab} onChange={(v) => v && navigate(`/patients/${patientId}/${v}`)} keepMounted={false}>
        <Tabs.List>
          {tabs.map(({ key, icon: I }) => (
            <Tabs.Tab key={key} value={key} leftSection={<I size={16} />} data-testid={`tab-${key}`}>
              {t(`patients.tabs.${key}`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Box pt="md">
          {tab === 'overview' && <OverviewTab patient={p} />}
          {tab === 'personal' && <PersonalTab patient={p} />}
          {tab === 'health' && can('patient.medical_view') && <HealthTab patient={p} />}
          {tab === 'activity' && can('audit.view') && <ActivityTab patientId={p.id} />}
          {tab === 'appointments' && can('appointment.view') && <PatientAppointments patientId={p.id} />}
          {tab === 'dental' && can('dental.view') && <DentalTab patient={p} />}
          {tab === 'plans' && can('plan.view') && <PlansTab patient={p} />}
          {tab === 'billing' && <PatientBillingTab patientId={p.id} />}
          {tab === 'files' && can('file.view') && <FilesTab patient={p} />}
          {tab === 'prescriptions' && can('dental.view') && <ClinicalTab patient={p} />}
          {TABS.filter((x) => x.milestone).map(
            (x) =>
              tab === x.key && (
                <Card key={x.key}>
                  <EmptyState icon={x.icon} title={t('common.comingSoon')} hint={t('placeholder.hint', { m: x.milestone })} />
                </Card>
              ),
          )}
        </Box>
      </Tabs>
    </Stack>
  );
}

function Box({ children, pt }: { children: ReactNode; pt: string }) {
  return <div style={{ paddingTop: `var(--mantine-spacing-${pt})` }}>{children}</div>;
}

function HeaderCard({ patient: p }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const age = p.dob ? ageParts(new Date(p.dob), new Date()) : null;
  const owes = p.balance !== '0.00' && !p.balance.startsWith('-');
  const warn = (label: string, text: string, color: string) =>
    text ? (
      <Tooltip label={text} multiline maw={320}>
        <Badge color={color} variant="light" leftSection={<IconAlertTriangle size={12} />} data-testid={`warn-${label}`}>
          {t(`patients.fields.${label}`)}: {text.length > 30 ? `${text.slice(0, 30)}…` : text}
        </Badge>
      </Tooltip>
    ) : null;

  return (
    <Card data-testid="patient-header">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="md" wrap="nowrap" align="flex-start">
          <Avatar size={56} radius="xl" color={p.gender === 'female' ? 'pink' : 'accent'}>
            {p.name_ar.slice(0, 1)}
          </Avatar>
          <Stack gap={4}>
            <Group gap="xs">
              <Title order={2}>{p.name_ar}</Title>
              {!p.is_active && <Badge color="neutral">{t('users.inactive')}</Badge>}
              {p.deleted_at && <Badge color="red">{t('master.deleted')}</Badge>}
              {p.is_external && <Badge color="grape">{t('patients.external')}</Badge>}
            </Group>
            {p.name_en && (
              <Text c="dimmed" size="sm" dir="ltr" ta="start">
                {p.name_en}
              </Text>
            )}
            <Group gap="lg" mt={4}>
              <Text size="sm">
                {t('patients.fileNo')} <b data-testid="file-no">{p.file_no}</b>
              </Text>
              {age && (
                <Text size="sm" data-testid="age">
                  {t('patients.age', { y: age.years, m: age.months, d: age.days })}
                </Text>
              )}
              {p.gender && <Text size="sm">{t(`patients.${p.gender}`)}</Text>}
              {p.mobile && (
                <Group gap={4}>
                  <Text size="sm" dir="ltr">
                    {p.mobile}
                  </Text>
                  <Tooltip label={t('patients.call')}>
                    <ActionIcon component="a" href={`tel:${p.mobile}`} variant="subtle" size="sm" aria-label={t('patients.call')}>
                      <IconPhone size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('patients.smsSoon')}>
                    <span>
                      <ActionIcon variant="subtle" size="sm" disabled aria-label="SMS">
                        <IconMessage size={14} />
                      </ActionIcon>
                    </span>
                  </Tooltip>
                </Group>
              )}
            </Group>
            <Group gap={6} mt={6}>
              {warn('allergies', p.allergies, 'red')}
              {warn('chronic_diseases', p.chronic_diseases, 'orange')}
            </Group>
          </Stack>
        </Group>
        <Stack gap={6} align="flex-end">
          {p.insurance ? (
            <Tooltip label={[p.insurance.class_name, p.insurance.expiry && formatDate(p.insurance.expiry, lang, digits)].filter(Boolean).join(' · ') || undefined} disabled={!p.insurance.class_name && !p.insurance.expiry}>
              <Badge color="teal" size="lg" leftSection={<IconShieldCheck size={14} />} data-testid="insurance-badge">
                {nameOf({ name_ar: p.insurance.company_name_ar ?? '', name_en: p.insurance.company_name_en ?? '' }, lang)}
              </Badge>
            </Tooltip>
          ) : (
            <Badge color="neutral" size="lg">
              {t('patients.cash')}
            </Badge>
          )}
          <Badge color={owes ? 'red' : 'green'} size="lg" variant={owes ? 'filled' : 'light'} data-testid="balance-badge">
            {t('sample.balance')}: {formatMoney(p.balance, lang, digits)}
          </Badge>
          {p.deposit_balance && p.deposit_balance !== '0.00' && (
            <Badge color="grape" size="lg" variant="light" data-testid="deposit-badge">
              {t('ledger.onAccount')}: {formatMoney(p.deposit_balance, lang, digits)}
            </Badge>
          )}
        </Stack>
      </Group>
    </Card>
  );
}

function ActionBar({ patient: p }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [assigning, setAssigning] = useState(false);
  const [sending, setSending] = useState<SendTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const act = async (path: string, method: 'POST' | 'DELETE' = 'POST') => {
    try {
      await api(`/patients/${p.id}${path}`, { method });
      await qc.invalidateQueries({ queryKey: ['patients'] });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
    }
  };

  return (
    <Group gap="xs" data-testid="action-bar">
      {can('appointment.create') && (
        <Button
          leftSection={<IconCalendarPlus size={16} />}
          onClick={() => navigate(`/appointments?new=1&patient=${p.id}&label=${encodeURIComponent(`${nameOf(p, lang)} · ${p.file_no}`)}`)}
          data-testid="profile-new-appointment"
        >
          {t('topbar.newAppointment')}
        </Button>
      )}
      {can('queue.manage') && (
        <Button
          variant="light"
          leftSection={<IconSend size={16} />}
          onClick={() => setSending({ patient_id: p.id, patient_label: `${nameOf(p, lang)} · ${p.file_no}`, doctor_id: p.default_doctor_id })}
          data-testid="profile-send"
        >
          {t('patients.sendToDoctor')}
        </Button>
      )}
      {can('quotation.edit') && (
        <Button variant="light" leftSection={<IconFileInvoice size={16} />} onClick={() => navigate(`/billing/quotation/new?patient=${p.id}`)} data-testid="profile-new-quotation">
          {t('patients.newQuotation')}
        </Button>
      )}
      {can('payment.collect') && (
        <Button variant="light" leftSection={<IconCash size={16} />} onClick={() => navigate(`/patients/${p.id}/billing`)} data-testid="profile-collect">
          {t('patients.collectPayment')}
        </Button>
      )}
      <Tooltip label={t('patients.smsSoon')}>
        <span>
          <Button variant="light" leftSection={<IconMessage size={16} />} disabled>
            {t('patients.sendSms')}
          </Button>
        </span>
      </Tooltip>
      <Menu position="bottom-end">
        <Menu.Target>
          <Button variant="default" rightSection={<IconChevronDown size={14} />} leftSection={<IconDots size={16} />} data-testid="more-actions">
            {t('patients.more')}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconPrinter size={16} />} disabled rightSection={<Text size="xs">M8</Text>}>
            {t('patients.printStatement')}
          </Menu.Item>
          {can('patient.assign') && (
            <Menu.Item leftSection={<IconUserShare size={16} />} onClick={() => setAssigning(true)} data-testid="assign">
              {t('patients.assign')}
            </Menu.Item>
          )}
          {can('patient.edit') &&
            (p.is_active ? (
              <Menu.Item leftSection={<IconUserOff size={16} />} onClick={() => void act('/deactivate')} data-testid="deactivate">
                {t('users.deactivate')}
              </Menu.Item>
            ) : (
              <Menu.Item leftSection={<IconUserCheck size={16} />} onClick={() => void act('/activate')}>
                {t('users.activate')}
              </Menu.Item>
            ))}
          {can('patient.delete') &&
            (p.deleted_at ? (
              <Menu.Item leftSection={<IconRestore size={16} />} onClick={() => void act('/restore')}>
                {t('master.restore')}
              </Menu.Item>
            ) : (
              <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => setDeleting(true)}>
                {t('common.delete')}
              </Menu.Item>
            ))}
        </Menu.Dropdown>
      </Menu>
      <SendToDoctorModal target={sending} onClose={() => setSending(null)} />
      <AssignModal patientId={p.id} opened={assigning} onClose={() => setAssigning(false)} />
      <Modal opened={deleting} onClose={() => setDeleting(false)} title={t('patients.deleteTitle')} size="sm">
        <Text size="sm">{t('patients.deleteBody')}</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            color="red"
            onClick={async () => {
              setDeleting(false);
              await act('', 'DELETE');
              navigate('/patients');
            }}
          >
            {t('common.delete')}
          </Button>
        </Group>
      </Modal>
    </Group>
  );
}

function AssignModal({ patientId, opened, onClose }: { patientId: number; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const staff = useQuery({
    queryKey: ['users', 'directory'],
    queryFn: () => api<{ id: number; full_name_ar: string; full_name_en: string }[]>('/users/directory'),
    enabled: opened,
  });
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setTo(null);
    setNote('');
    setError(null);
  }, [opened]);
  return (
    <Modal opened={opened} onClose={onClose} title={t('patients.assign')} size="sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/patients/${patientId}/assignments`, { method: 'POST', body: { assigned_to: Number(to), note } });
            await qc.invalidateQueries({ queryKey: ['patients', 'assignments', patientId] });
            notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('patients.assigned') });
            onClose();
          } catch (err) {
            setError(err);
          }
        }}
        data-testid="assign-form"
      >
        <Stack>
          {error !== null && (
            <Alert color="red" variant="light">
              {errorMessage(t, error, lang)}
            </Alert>
          )}
          <Select
            label={t('patients.assignTo')}
            data={(staff.data ?? []).map((u) => ({ value: String(u.id), label: lang === 'ar' ? u.full_name_ar : u.full_name_en || u.full_name_ar }))}
            value={to}
            onChange={setTo}
            searchable
            required
          />
          <Textarea label={t('sample.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} required placeholder={t('patients.assignNoteHint')} autosize minRows={2} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!to || !note.trim()}>
              {t('patients.assign')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function OverviewTab({ patient: p }: { patient: Patient }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { lang, digits } = usePrefs();
  const qc = useQueryClient();
  const doctors = useDoctors({ includeInactive: true });
  const assignments = useQuery({
    queryKey: ['patients', 'assignments', p.id],
    queryFn: () => api<Assignment[]>(`/patients/${p.id}/assignments`),
  });
  const open = (assignments.data ?? []).filter((a) => !a.done_at);
  const later = (title: string, m: string) => (
    <Card>
      <Text fw={600} mb={4}>
        {title}
      </Text>
      <Text size="sm" c="dimmed">
        {t('common.milestone', { m })}
      </Text>
    </Card>
  );
  const info = (label: string, value: ReactNode) => (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="end">
        {value || '—'}
      </Text>
    </Group>
  );
  return (
    <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
      <Card>
        <Text fw={600} mb="xs">
          {t('patients.summary')}
        </Text>
        <Stack gap={6}>
          {info(t('patients.doctor'), nameOf(doctors.data?.find((d) => d.id === p.default_doctor_id), lang))}
          {info(t('patients.lastVisit'), p.last_visit_at ? formatDate(p.last_visit_at, lang, digits) : null)}
          {info(t('sample.balance'), formatMoney(p.balance, lang, digits))}
          {info(t('patients.registered'), formatDateTime(p.created_at, lang, digits))}
          {info(t('patients.fields.emergency_name'), p.emergency_name && `${p.emergency_name} ${p.emergency_phone ?? ''}`)}
        </Stack>
      </Card>
      <Card data-testid="open-assignments">
        <Text fw={600} mb="xs">
          {t('patients.openAssignments')}
        </Text>
        {open.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('patients.noAssignments')}
          </Text>
        ) : (
          <Stack gap="xs">
            {open.map((a) => (
              <Group key={a.id} justify="space-between" wrap="nowrap" align="flex-start">
                <div>
                  <Text size="sm">{a.note}</Text>
                  <Text size="xs" c="dimmed">
                    {a.assigned_by_name} → {a.assigned_to_name} · {formatDateTime(a.created_at, lang, digits)}
                  </Text>
                </div>
                <Tooltip label={t('patients.markDone')}>
                  <ActionIcon
                    variant="light"
                    color="green"
                    onClick={async () => {
                      try {
                        await api(`/assignments/${a.id}/done`, { method: 'POST' });
                        await qc.invalidateQueries({ queryKey: ['patients', 'assignments', p.id] });
                        await qc.invalidateQueries({ queryKey: ['assignments', 'mine'] });
                      } catch (e) {
                        notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
                      }
                    }}
                    aria-label={t('patients.markDone')}
                  >
                    <IconCheck size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Stack>
        )}
      </Card>
      {p.notes && (
        <Card>
          <Text fw={600} mb="xs">
            {t('patients.fields.notes')}
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {p.notes}
          </Text>
        </Card>
      )}
      {can('appointment.view') && <UpcomingCard patientId={p.id} />}
      {later(t('patients.openPlans'), 'M7')}
      {later(t('patients.lastVisitSummary'), 'M6')}
    </SimpleGrid>
  );
}

function PersonalTab({ patient: p }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<PatientFormValues>(() => toForm(p));
  const [base, setBase] = useState<PatientFormValues>(() => toForm(p));
  const [version, setVersion] = useState(p.version);
  const [errors, setErrors] = useState<Partial<Record<keyof PatientFormValues, string>>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dups = useDuplicates(form.national_id !== base.national_id ? form.national_id : '', form.mobile !== base.mobile ? form.mobile : '', p.id);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const editable = can('patient.edit') && !p.deleted_at;

  async function save(): Promise<boolean> {
    const e = validate(form, t);
    setErrors(e);
    if (Object.keys(e).length) return false;
    setBusy(true);
    setError(null);
    try {
      const body = toBody(form);
      const saved = await api<Patient>(`/patients/${p.id}`, {
        method: 'PATCH',
        body: { ...body, version, clear_insurance: !body.insurance && !!p.insurance },
      });
      qc.setQueryData(patientKeys.one(p.id), saved);
      void qc.invalidateQueries({ queryKey: ['patients', 'list'] });
      setBase(toForm(saved));
      setForm(toForm(saved));
      setVersion(saved.version);
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const fresh = await api<Patient>(`/patients/${p.id}`);
    qc.setQueryData(patientKeys.one(p.id), fresh);
    setBase(toForm(fresh));
    setForm(toForm(fresh));
    setVersion(fresh.version);
    setError(null);
  }

  const guard = useUnsavedGuard(dirty, save);
  const stale = error instanceof ApiError && error.code === 'stale_record';

  return (
    <Card maw={900}>
      {guard}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
        }}
        data-testid="personal-form"
      >
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
          <Stack>
            {error !== null && (
              <Alert color={stale ? 'yellow' : 'red'} variant="light">
                <Group justify="space-between">
                  <Text size="sm">{errorMessage(t, error, lang)}</Text>
                  {stale && (
                    <Button size="xs" variant="white" onClick={() => void reload()}>
                      {t('common.reload')}
                    </Button>
                  )}
                </Group>
              </Alert>
            )}
            <DuplicateAlert dups={dups} />
            <PatientFields value={form} onChange={setForm} errors={errors} />
            {editable && (
              <Group justify="flex-end">
                <Button variant="default" disabled={!dirty} onClick={() => setForm(base)}>
                  {t('common.discard')}
                </Button>
                <Button type="submit" loading={busy} disabled={!dirty}>
                  {t('common.save')}
                </Button>
              </Group>
            )}
          </Stack>
        </fieldset>
      </form>
    </Card>
  );
}

function HealthTab({ patient: p }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  // Every opening of this tab is a logged read of the medical file (SPEC 3.4): never cached.
  const q = useQuery({ queryKey: ['patients', 'health', p.id], queryFn: () => api<Health>(`/patients/${p.id}/health`), gcTime: 0, staleTime: 0 });
  const [form, setForm] = useState<Health | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  const dirty = !!form && !!q.data && JSON.stringify(form) !== JSON.stringify(q.data);
  const editable = (can('patient.edit') || can('dental.edit')) && !p.deleted_at;

  async function save(): Promise<boolean> {
    if (!form) return false;
    setBusy(true);
    setError(null);
    try {
      const saved = await api<Health>(`/patients/${p.id}/health`, { method: 'PUT', body: form });
      qc.setQueryData(['patients', 'health', p.id], saved);
      void qc.invalidateQueries({ queryKey: patientKeys.one(p.id) });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const guard = useUnsavedGuard(dirty, save);

  if (!form) return <Skeleton height={300} radius="md" />;
  const area = (k: keyof Omit<Health, 'version'>, rows = 3) => (
    <Textarea label={t(`patients.fields.${k}`)} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.currentTarget.value })} autosize minRows={rows} readOnly={!editable} name={k} />
  );
  return (
    <Card maw={900}>
      {guard}
      <Stack>
        <Group gap="xs">
          <IconHeartbeat size={18} />
          <Text fw={600}>{t('patients.tabs.health')}</Text>
          <Text size="xs" c="dimmed">
            {t('patients.healthLogged')}
          </Text>
        </Group>
        {error !== null && (
          <Alert color="red" variant="light">
            {errorMessage(t, error, lang)}
          </Alert>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {area('chronic_diseases')}
          {area('allergies')}
        </SimpleGrid>
        {area('medications')}
        {area('medical_history', 5)}
        {editable && (
          <Group justify="flex-end">
            <Button onClick={() => void save()} loading={busy} disabled={!dirty} data-testid="save-health">
              {t('common.save')}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

function ActivityTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const q = useQuery({ queryKey: ['patients', 'activity', patientId], queryFn: () => api<AuditRow[]>(`/patients/${patientId}/activity`) });
  if (q.isPending) return <Skeleton height={200} radius="md" />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  return (
    <Card padding={0}>
      <Table.ScrollContainer minWidth={700}>
        <Table data-testid="activity-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('audit.at')}</Table.Th>
              <Table.Th>{t('audit.user')}</Table.Th>
              <Table.Th>{t('audit.action')}</Table.Th>
              <Table.Th>{t('audit.table')}</Table.Th>
              <Table.Th>{t('audit.field')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {q.data.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td fz="sm">{formatDateTime(r.at, lang, digits)}</Table.Td>
                <Table.Td>{r.user_name ?? '—'}</Table.Td>
                <Table.Td>
                  <Badge color={r.action === 'read' ? 'blue' : r.action === 'delete' ? 'red' : 'neutral'}>{t(`audit.actions.${r.action}`, { defaultValue: r.action })}</Badge>
                </Table.Td>
                <Table.Td>{t(`audit.tables.${r.table_name}`, { defaultValue: r.table_name })}</Table.Td>
                <Table.Td fz="xs" c="dimmed">
                  {Object.keys(r.new_json ?? r.old_json ?? {})
                    .slice(0, 6)
                    .map((k) => t(`patients.fields.${k}`, { defaultValue: k }))
                    .join('، ')}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

export function PatientLink({ id, children }: { id: number; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <Anchor component="button" onClick={() => navigate(`/patients/${id}`)}>
      {children}
    </Anchor>
  );
}
