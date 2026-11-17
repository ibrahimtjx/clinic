import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Drawer,
  Group,
  Modal,
  MultiSelect,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFlask, IconPencil, IconPill, IconPlus, IconPrinter, IconReportMedical, IconTrash, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime } from '../lib/format';
import { printDoc } from '../lib/print';
import { nameOf, useDoctors } from '../master/queries';
import type { Patient } from '../patients/types';
import type { LabRequest, LabTest, MedicalReport, Medication, Prescription, RxItem } from './types';

type Section = 'prescriptions' | 'lab' | 'reports';
const STATUS_COLOR = { active: 'blue', resulted: 'green', cancelled: 'red' } as const;

/** Prescriptions, lab requests and results, medical reports (SPEC 8.6). */
export function ClinicalTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>('prescriptions');
  return (
    <Stack data-testid="clinical-tab">
      <SegmentedControl
        value={section}
        onChange={(v) => setSection(v as Section)}
        data={[
          { value: 'prescriptions', label: t('clinical.prescriptions') },
          { value: 'lab', label: t('clinical.lab') },
          { value: 'reports', label: t('clinical.reports') },
        ]}
        w="fit-content"
      />
      {patient.allergies && (
        <Alert color="red" variant="light" py={6}>
          {t('clinical.allergies')}: {patient.allergies}
        </Alert>
      )}
      {section === 'prescriptions' && <Prescriptions patient={patient} />}
      {section === 'lab' && <LabRequests patient={patient} />}
      {section === 'reports' && <Reports patient={patient} />}
    </Stack>
  );
}

function useMyDoctor(patient: Patient) {
  const { me } = useAuth();
  const doctors = useDoctors();
  const mine = doctors.data?.find((d) => d.user_id === me?.id);
  return { doctors, defaultId: mine?.id ?? patient.default_doctor_id ?? null };
}

function DoctorSelect({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const doctors = useDoctors();
  const { me } = useAuth();
  // A doctor writes in their own name (the server refuses another doctor's); other staff choose.
  const mine = doctors.data?.find((d) => d.user_id === me?.id);
  useEffect(() => {
    if (mine && value !== mine.id) onChange(mine.id);
  }, [mine, value, onChange]);
  return (
    <Select
      label={t('appointments.doctor')}
      required
      data={(doctors.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
      value={value ? String(value) : null}
      onChange={(v) => onChange(v ? Number(v) : null)}
      disabled={!!mine}
      searchable
    />
  );
}

function DocHeader({ doc, onPrint, onEdit, onCancel, extra }: { doc: { issued_at: string; status: keyof typeof STATUS_COLOR; doctor_name_ar: string; doctor_name_en: string; cancel_reason: string | null; editable: boolean }; onPrint: () => void; onEdit?: () => void; onCancel?: () => void; extra?: React.ReactNode }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs">
        <Text fw={600}>{formatDateTime(doc.issued_at, lang, digits)}</Text>
        <Text size="sm" c="dimmed">
          {lang === 'ar' ? doc.doctor_name_ar : doc.doctor_name_en}
        </Text>
        <Badge color={STATUS_COLOR[doc.status]} variant="light">
          {t(`clinical.status.${doc.status}`)}
        </Badge>
        {doc.cancel_reason && (
          <Text size="xs" c="red">
            {doc.cancel_reason}
          </Text>
        )}
      </Group>
      <Group gap={4} wrap="nowrap">
        {extra}
        {onEdit && doc.editable && (
          <ActionIcon variant="subtle" onClick={onEdit} aria-label={t('common.edit')}>
            <IconPencil size={16} />
          </ActionIcon>
        )}
        {onCancel && doc.status !== 'cancelled' && (
          <ActionIcon variant="subtle" color="red" onClick={onCancel} aria-label={t('clinical.cancel')}>
            <IconX size={16} />
          </ActionIcon>
        )}
        <ActionIcon variant="subtle" onClick={onPrint} aria-label={t('print.print')} data-testid="clinical-print">
          <IconPrinter size={16} />
        </ActionIcon>
      </Group>
    </Group>
  );
}

function CancelModal({ path, version, onClose, invalidate }: { path: string | null; version: number; onClose: () => void; invalidate: unknown[] }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const submit = async () => {
    try {
      await api(`${path}/cancel`, { method: 'POST', body: { version, reason } });
      await qc.invalidateQueries({ queryKey: invalidate });
      setReason('');
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
    }
  };
  return (
    <Modal opened={!!path} onClose={onClose} title={t('clinical.cancelTitle')}>
      <Stack>
        <Textarea label={t('clinical.cancelReason')} value={reason} onChange={(e) => setReason(e.currentTarget.value)} required autosize minRows={2} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button color="red" disabled={reason.trim().length < 3} onClick={() => void submit()}>
            {t('clinical.cancel')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------- prescriptions
const blankItem = (): RxItem => ({ drug: '', form: '', dose: '', frequency: '', duration: '', quantity: '', instructions: '' });

function Prescriptions({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const key = ['clinical', 'rx', patient.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Prescription[]>(`/patients/${patient.id}/prescriptions`), gcTime: 0 });
  const [editing, setEditing] = useState<Prescription | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<Prescription | null>(null);
  if (q.isPending) return <Skeleton height={160} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  return (
    <Stack>
      {can('dental.edit') && (
        <Group>
          <Button leftSection={<IconPill size={16} />} onClick={() => setEditing('new')} data-testid="new-prescription">
            {t('clinical.newPrescription')}
          </Button>
        </Group>
      )}
      {q.data.length === 0 && (
        <Card>
          <EmptyState icon={IconPill} title={t('clinical.noPrescriptions')} hint="" />
        </Card>
      )}
      {q.data.map((rx) => (
        <Card key={rx.id} withBorder data-testid={`rx-${rx.id}`} opacity={rx.status === 'cancelled' ? 0.6 : 1}>
          <DocHeader doc={rx} onPrint={() => void printDoc(`/print/prescription/${rx.id}`)} onEdit={() => setEditing(rx)} onCancel={can('dental.edit') ? () => setCancelling(rx) : undefined} />
          {rx.diagnosis && (
            <Text size="sm" mt={4}>
              {t('clinical.diagnosis')}: {rx.diagnosis}
            </Text>
          )}
          <Table mt="xs" fz="sm">
            <Table.Tbody>
              {rx.items.map((it) => (
                <Table.Tr key={it.seq}>
                  <Table.Td fw={600} dir="ltr" ta="start">
                    {it.drug}
                  </Table.Td>
                  <Table.Td dir="ltr" ta="start">
                    {[it.dose, it.frequency, it.duration].filter(Boolean).join(' · ')}
                  </Table.Td>
                  <Table.Td c="dimmed">{it.instructions}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ))}
      {editing && <RxDrawer patient={patient} rx={editing === 'new' ? null : editing} onClose={() => setEditing(null)} invalidate={key} />}
      <CancelModal path={cancelling ? `/prescriptions/${cancelling.id}` : null} version={cancelling?.version ?? 0} onClose={() => setCancelling(null)} invalidate={key} />
    </Stack>
  );
}

function RxDrawer({ patient, rx, onClose, invalidate }: { patient: Patient; rx: Prescription | null; onClose: () => void; invalidate: unknown[] }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const { defaultId } = useMyDoctor(patient);
  const meds = useQuery({ queryKey: ['master', 'medications'], queryFn: () => api<Medication[]>('/medications') });
  const [doctorId, setDoctorId] = useState<number | null>(rx?.doctor_id ?? defaultId);
  const [diagnosis, setDiagnosis] = useState(rx?.diagnosis ?? '');
  const [notes, setNotes] = useState(rx?.notes ?? '');
  const [items, setItems] = useState<RxItem[]>(rx ? rx.items.map(({ seq: _seq, ...i }) => i) : [blankItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (i: number, patch: Partial<RxItem>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const pickDrug = (i: number, name: string) => {
    const m = meds.data?.find((x) => x.name === name);
    set(i, m ? { drug: m.name, form: m.form, dose: m.dose, frequency: m.frequency, duration: m.duration, instructions: m.instructions } : { drug: name });
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { diagnosis, notes, items: items.filter((i) => i.drug.trim()) };
    try {
      if (rx) await api(`/prescriptions/${rx.id}`, { method: 'PATCH', body: { version: rx.version, ...body } });
      else await api(`/patients/${patient.id}/prescriptions`, { method: 'POST', body: { ...body, doctor_id: doctorId } });
      await qc.invalidateQueries({ queryKey: invalidate });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title={rx ? t('clinical.editPrescription') : t('clinical.newPrescription')}>
      <Stack data-testid="rx-form">
        {!rx && <DoctorSelect value={doctorId} onChange={setDoctorId} />}
        <TextInput label={t('clinical.diagnosis')} value={diagnosis} onChange={(e) => setDiagnosis(e.currentTarget.value)} maxLength={1000} />
        {items.map((it, i) => (
          <Card key={i} withBorder padding="xs">
            <Group align="flex-end" wrap="nowrap" gap="xs">
              <Autocomplete
                label={i === 0 ? t('clinical.drug') : undefined}
                data={(meds.data ?? []).map((m) => m.name)}
                value={it.drug}
                onChange={(v) => pickDrug(i, v)}
                style={{ flex: 1 }}
                dir="ltr"
                data-testid={`rx-drug-${i}`}
              />
              <ActionIcon variant="subtle" color="red" mb={4} onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))} disabled={items.length === 1} aria-label={t('common.delete')}>
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
            <SimpleGrid cols={{ base: 2, md: 4 }} mt={6} spacing="xs">
              <TextInput size="xs" placeholder={t('clinical.dose')} value={it.dose} onChange={(e) => set(i, { dose: e.currentTarget.value })} dir="auto" />
              <TextInput size="xs" placeholder={t('clinical.frequency')} value={it.frequency} onChange={(e) => set(i, { frequency: e.currentTarget.value })} dir="auto" />
              <TextInput size="xs" placeholder={t('clinical.duration')} value={it.duration} onChange={(e) => set(i, { duration: e.currentTarget.value })} dir="auto" />
              <TextInput size="xs" placeholder={t('clinical.quantity')} value={it.quantity} onChange={(e) => set(i, { quantity: e.currentTarget.value })} dir="auto" />
            </SimpleGrid>
            <TextInput size="xs" mt={6} placeholder={t('clinical.instructions')} value={it.instructions} onChange={(e) => set(i, { instructions: e.currentTarget.value })} dir="auto" />
          </Card>
        ))}
        <Button variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setItems((xs) => [...xs, blankItem()])} w="fit-content">
          {t('clinical.addDrug')}
        </Button>
        <Textarea label={t('sample.note')} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} autosize minRows={2} />
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!doctorId || !items.some((i) => i.drug.trim())} data-testid="save-rx">
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}

// ---------------------------------------------------------------- lab
function LabRequests({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const key = ['clinical', 'lab', patient.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<LabRequest[]>(`/patients/${patient.id}/lab-requests`), gcTime: 0 });
  const [editing, setEditing] = useState<LabRequest | 'new' | null>(null);
  const [results, setResults] = useState<LabRequest | null>(null);
  const [cancelling, setCancelling] = useState<LabRequest | null>(null);
  if (q.isPending) return <Skeleton height={160} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  return (
    <Stack>
      {can('dental.edit') && (
        <Group>
          <Button leftSection={<IconFlask size={16} />} onClick={() => setEditing('new')} data-testid="new-lab">
            {t('clinical.newLab')}
          </Button>
        </Group>
      )}
      {q.data.length === 0 && (
        <Card>
          <EmptyState icon={IconFlask} title={t('clinical.noLab')} hint="" />
        </Card>
      )}
      {q.data.map((r) => (
        <Card key={r.id} withBorder opacity={r.status === 'cancelled' ? 0.6 : 1} data-testid={`lab-${r.id}`}>
          <DocHeader
            doc={r}
            onPrint={() => void printDoc(`/print/lab/${r.id}`)}
            onEdit={r.status === 'active' ? () => setEditing(r) : undefined}
            onCancel={can('dental.edit') ? () => setCancelling(r) : undefined}
            extra={
              can('dental.edit') && r.status !== 'cancelled' ? (
                <Button size="xs" variant="light" onClick={() => setResults(r)} data-testid="enter-results">
                  {t('clinical.enterResults')}
                </Button>
              ) : null
            }
          />
          <Text size="sm" c="dimmed" mt={4}>
            {[r.lab_name, r.clinical_info].filter(Boolean).join(' · ')}
          </Text>
          <Table mt="xs" fz="sm">
            <Table.Tbody>
              {r.items.map((it) => (
                <Table.Tr key={it.seq}>
                  <Table.Td dir="ltr" ta="start">
                    {it.name}
                  </Table.Td>
                  <Table.Td dir="ltr" ta="start" fw={600} c={it.flag && it.flag !== 'normal' ? 'red' : undefined}>
                    {it.result ? `${it.result} ${it.unit}` : '—'}
                  </Table.Td>
                  <Table.Td dir="ltr" ta="start" c="dimmed">
                    {it.reference_range}
                  </Table.Td>
                  <Table.Td>{it.flag && <Badge size="xs" color={it.flag === 'normal' ? 'green' : 'red'}>{t(`clinical.flags.${it.flag}`)}</Badge>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ))}
      {editing && <LabDrawer patient={patient} req={editing === 'new' ? null : editing} onClose={() => setEditing(null)} invalidate={key} />}
      {results && <ResultsModal req={results} onClose={() => setResults(null)} invalidate={key} />}
      <CancelModal path={cancelling ? `/lab-requests/${cancelling.id}` : null} version={cancelling?.version ?? 0} onClose={() => setCancelling(null)} invalidate={key} />
    </Stack>
  );
}

function LabDrawer({ patient, req, onClose, invalidate }: { patient: Patient; req: LabRequest | null; onClose: () => void; invalidate: unknown[] }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const { defaultId } = useMyDoctor(patient);
  const tests = useQuery({ queryKey: ['master', 'lab-tests'], queryFn: () => api<LabTest[]>('/lab-tests') });
  const [doctorId, setDoctorId] = useState<number | null>(req?.doctor_id ?? defaultId);
  const [labName, setLabName] = useState(req?.lab_name ?? '');
  const [info, setInfo] = useState(req?.clinical_info ?? '');
  const [picked, setPicked] = useState<string[]>(req ? req.items.map((i) => (i.test_id ? String(i.test_id) : i.name)) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const options = (tests.data ?? []).map((x) => ({ value: String(x.id), label: `${nameOf(x, lang)}${x.code ? ` (${x.code})` : ''}` }));
  const save = async () => {
    setBusy(true);
    setError(null);
    const items = picked.map((v) => {
      const test = tests.data?.find((x) => String(x.id) === v);
      return test ? { test_id: test.id, name: test.name_en, unit: test.unit, reference_range: test.reference_range } : { test_id: null, name: v, unit: '', reference_range: '' };
    });
    const body = { lab_name: labName, clinical_info: info, items };
    try {
      if (req) await api(`/lab-requests/${req.id}`, { method: 'PATCH', body: { version: req.version, ...body } });
      else await api(`/patients/${patient.id}/lab-requests`, { method: 'POST', body: { ...body, doctor_id: doctorId } });
      await qc.invalidateQueries({ queryKey: invalidate });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer opened onClose={onClose} position="right" size="lg" title={req ? t('clinical.editLab') : t('clinical.newLab')}>
      <Stack data-testid="lab-form">
        {!req && <DoctorSelect value={doctorId} onChange={setDoctorId} />}
        <MultiSelect label={t('clinical.tests')} data={options} value={picked} onChange={setPicked} searchable required data-testid="lab-tests" />
        <TextInput label={t('clinical.labName')} value={labName} onChange={(e) => setLabName(e.currentTarget.value)} maxLength={200} />
        <Textarea label={t('clinical.clinicalInfo')} value={info} onChange={(e) => setInfo(e.currentTarget.value)} autosize minRows={2} />
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!doctorId || picked.length === 0} data-testid="save-lab">
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}

function ResultsModal({ req, onClose, invalidate }: { req: LabRequest; onClose: () => void; invalidate: unknown[] }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const [rows, setRows] = useState(req.items.map((i) => ({ seq: i.seq, result: i.result, flag: i.flag })));
  const [note, setNote] = useState(req.result_note);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/lab-requests/${req.id}/results`, { method: 'POST', body: { version: req.version, results: rows, result_note: note } });
      await qc.invalidateQueries({ queryKey: invalidate });
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title={t('clinical.enterResults')} size="lg">
      <Stack>
        {req.items.map((it, k) => (
          <Group key={it.seq} wrap="nowrap" align="flex-end">
            <Text size="sm" w={200} dir="ltr">
              {it.name}
              <Text span size="xs" c="dimmed">
                {' '}
                {it.reference_range} {it.unit}
              </Text>
            </Text>
            <TextInput size="xs" value={rows[k].result} onChange={(e) => setRows((r) => r.map((x, i) => (i === k ? { ...x, result: e.currentTarget.value } : x)))} w={120} dir="ltr" data-testid={`result-${k}`} />
            <Select
              size="xs"
              data={(['normal', 'low', 'high', 'abnormal'] as const).map((f) => ({ value: f, label: t(`clinical.flags.${f}`) }))}
              value={rows[k].flag}
              onChange={(v) => setRows((r) => r.map((x, i) => (i === k ? { ...x, flag: v as typeof x.flag } : x)))}
              clearable
              w={130}
            />
          </Group>
        ))}
        <Textarea label={t('sample.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize />
        <Group justify="flex-end">
          <Button onClick={() => void save()} loading={busy} data-testid="save-results">
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------- medical reports
function template(kind: MedicalReport['kind'], language: 'ar' | 'en', patient: Patient, lang: 'ar' | 'en', digits: 'latn' | 'arab') {
  const today = formatDate(new Date(), language, digits);
  const name = language === 'ar' ? patient.name_ar : patient.name_en || patient.name_ar;
  void lang;
  if (language === 'ar') {
    if (kind === 'attendance') return `نفيد بأن المريض/ة ${name} (رقم الملف ${patient.file_no}) راجع/ت العيادة بتاريخ ${today}.\n\nأعطي هذا الإشعار بناءً على طلبه/ا دون أدنى مسؤولية على العيادة.`;
    if (kind === 'referral') return `نحيل إليكم المريض/ة ${name} (رقم الملف ${patient.file_no}) للتكرم بالفحص والعلاج اللازم.\n\nالتشخيص المبدئي: \nالعلاج المقدم: \n\nمع وافر الشكر والتقدير.`;
    return `تقرير طبي للمريض/ة ${name} (رقم الملف ${patient.file_no}).\n\nالشكوى: \nالفحص: \nالتشخيص: \nالعلاج: \nالتوصيات: `;
  }
  if (kind === 'attendance') return `This is to certify that ${name} (file no. ${patient.file_no}) attended the clinic on ${today}.\n\nIssued at the patient's request.`;
  if (kind === 'referral') return `We refer ${name} (file no. ${patient.file_no}) to you for examination and the necessary treatment.\n\nProvisional diagnosis: \nTreatment given: \n\nWith thanks.`;
  return `Medical report for ${name} (file no. ${patient.file_no}).\n\nComplaint: \nExamination: \nDiagnosis: \nTreatment: \nRecommendations: `;
}

function Reports({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const key = ['clinical', 'reports', patient.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<MedicalReport[]>(`/patients/${patient.id}/medical-reports`), gcTime: 0 });
  const [editing, setEditing] = useState<MedicalReport | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<MedicalReport | null>(null);
  if (q.isPending) return <Skeleton height={160} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  return (
    <Stack>
      {can('dental.edit') && (
        <Group>
          <Button leftSection={<IconReportMedical size={16} />} onClick={() => setEditing('new')} data-testid="new-report">
            {t('clinical.newReport')}
          </Button>
        </Group>
      )}
      {q.data.length === 0 && (
        <Card>
          <EmptyState icon={IconReportMedical} title={t('clinical.noReports')} hint="" />
        </Card>
      )}
      {q.data.map((r) => (
        <Card key={r.id} withBorder opacity={r.status === 'cancelled' ? 0.6 : 1} data-testid={`report-${r.id}`}>
          <DocHeader doc={r} onPrint={() => void printDoc(`/print/medical-report/${r.id}`)} onEdit={() => setEditing(r)} onCancel={can('dental.edit') ? () => setCancelling(r) : undefined} extra={<Badge variant="outline">{t(`clinical.reportKinds.${r.kind}`)}</Badge>} />
          <Text size="sm" fw={500} mt={4}>
            {r.title}
            {r.recipient ? ` · ${r.recipient}` : ''}
          </Text>
          <Text size="sm" c="dimmed" lineClamp={2} dir={r.language === 'ar' ? 'rtl' : 'ltr'} style={{ whiteSpace: 'pre-wrap' }}>
            {r.body}
          </Text>
        </Card>
      ))}
      {editing && <ReportDrawer patient={patient} report={editing === 'new' ? null : editing} onClose={() => setEditing(null)} invalidate={key} />}
      <CancelModal path={cancelling ? `/medical-reports/${cancelling.id}` : null} version={cancelling?.version ?? 0} onClose={() => setCancelling(null)} invalidate={key} />
    </Stack>
  );
}

function ReportDrawer({ patient, report, onClose, invalidate }: { patient: Patient; report: MedicalReport | null; onClose: () => void; invalidate: unknown[] }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const qc = useQueryClient();
  const { defaultId } = useMyDoctor(patient);
  const [doctorId, setDoctorId] = useState<number | null>(report?.doctor_id ?? defaultId);
  const [kind, setKind] = useState<MedicalReport['kind']>(report?.kind ?? 'report');
  const [language, setLanguage] = useState<'ar' | 'en'>(report?.language ?? 'ar');
  const [recipient, setRecipient] = useState(report?.recipient ?? (lang === 'ar' ? 'إلى من يهمه الأمر' : 'To whom it may concern'));
  const [title, setTitle] = useState(report?.title ?? '');
  const [body, setBody] = useState(report?.body ?? template('report', 'ar', patient, lang, digits));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const retemplate = (k: MedicalReport['kind'], l: 'ar' | 'en') => {
    if (!report) {
      setBody(template(k, l, patient, lang, digits));
      setRecipient(l === 'ar' ? 'إلى من يهمه الأمر' : 'To whom it may concern');
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const data = { kind, language, recipient, title: title || t(`clinical.reportKinds.${kind}`), body };
    try {
      if (report) await api(`/medical-reports/${report.id}`, { method: 'PATCH', body: { version: report.version, ...data } });
      else await api(`/patients/${patient.id}/medical-reports`, { method: 'POST', body: { ...data, doctor_id: doctorId } });
      await qc.invalidateQueries({ queryKey: invalidate });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title={report ? t('clinical.editReport') : t('clinical.newReport')}>
      <Stack data-testid="report-form">
        {!report && <DoctorSelect value={doctorId} onChange={setDoctorId} />}
        <Group grow>
          <Select
            label={t('clinical.reportKind')}
            data={(['report', 'referral', 'attendance'] as const).map((k) => ({ value: k, label: t(`clinical.reportKinds.${k}`) }))}
            value={kind}
            onChange={(v) => {
              if (!v) return;
              setKind(v as MedicalReport['kind']);
              retemplate(v as MedicalReport['kind'], language);
            }}
            allowDeselect={false}
          />
          <Select
            label={t('clinical.language')}
            data={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
            ]}
            value={language}
            onChange={(v) => {
              if (!v) return;
              setLanguage(v as 'ar' | 'en');
              retemplate(kind, v as 'ar' | 'en');
            }}
            allowDeselect={false}
          />
        </Group>
        <TextInput label={t('clinical.recipient')} value={recipient} onChange={(e) => setRecipient(e.currentTarget.value)} dir={language === 'ar' ? 'rtl' : 'ltr'} />
        <TextInput label={t('files.title')} value={title} onChange={(e) => setTitle(e.currentTarget.value)} placeholder={t(`clinical.reportKinds.${kind}`)} dir={language === 'ar' ? 'rtl' : 'ltr'} />
        <Textarea label={t('clinical.body')} value={body} onChange={(e) => setBody(e.currentTarget.value)} autosize minRows={10} dir={language === 'ar' ? 'rtl' : 'ltr'} data-testid="report-body" />
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!doctorId || !body.trim()} data-testid="save-report">
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
