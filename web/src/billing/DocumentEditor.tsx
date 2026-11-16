import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCash, IconCheck, IconFileInvoice, IconPlus, IconPrinter, IconSend, IconShieldCheck, IconTrash, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { MoneyInput } from '../components/MoneyInput';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { nameOf, useDoctors, useServices } from '../master/queries';
import { usePatient } from '../patients/queries';
import { CollectModal } from './CollectModal';
import type { BillingDoc, DocKind, EditLine, InsuranceClass, Preview } from './types';
import { printDoc } from '../lib/print';

let keySeq = 0;
const newKey = () => `l${++keySeq}`;

const blankLine = (): EditLine => ({ key: newKey(), service_id: null, description_ar: '', description_en: '', price: '0', qty: '1', discount_mode: 'pct', discount: '0', teeth: '' });

const toEdit = (d: BillingDoc): EditLine[] =>
  d.lines.map((l) => ({
    key: newKey(),
    service_id: l.service_id,
    description_ar: l.description_ar,
    description_en: l.description_en,
    price: l.price,
    qty: l.qty,
    discount_mode: l.discount_amount !== '0.00' ? 'amount' : 'pct',
    discount: l.discount_amount !== '0.00' ? l.discount_amount : l.discount_pct,
    teeth: l.teeth.join(' '),
  }));

const toApi = (l: EditLine) => ({
  service_id: l.service_id,
  description_ar: l.service_id ? null : l.description_ar,
  description_en: l.service_id ? null : l.description_en,
  price: l.price || '0',
  qty: l.qty || '1',
  discount_amount: l.discount_mode === 'amount' ? l.discount || '0' : '0',
  discount_pct: l.discount_mode === 'pct' ? l.discount || '0' : '0',
  teeth: l.teeth
    .split(/[\s,،]+/)
    .map(Number)
    .filter((n) => n > 0),
});

const STATUS_COLOR: Record<string, string> = { draft: 'neutral', sent: 'blue', accepted: 'green', converted: 'teal', paid: 'green', expired: 'orange', cancelled: 'red' };

/** Quotation and payment order screen (SPEC 10.3). Totals always come from the server. */
export function DocumentEditor() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { kind: kindParam, id } = useParams();
  const [params] = useSearchParams();
  const kind: DocKind = kindParam === 'payment-order' ? 'payment_order' : 'quotation';
  const path = kind === 'quotation' ? '/quotations' : '/payment-orders';
  const isNew = id === 'new';
  const doc = useQuery({ queryKey: ['billing', kind, id], queryFn: () => api<BillingDoc>(`${path}/${id}`), enabled: !isNew });
  const patientId = isNew ? Number(params.get('patient')) : doc.data?.patient_id;
  const patient = usePatient(patientId ?? 0);
  const doctors = useDoctors();
  const services = useServices();
  const classes = useQuery({ queryKey: ['master', 'insurance-classes'], queryFn: () => api<InsuranceClass[]>('/insurance-classes') });

  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [useIns, setUseIns] = useState(true);
  const [classId, setClassId] = useState<number | null>(null);
  const [base, setBase] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    if (isNew) {
      const plan = Number(params.get('plan')) || null;
      setDoctorId(Number(params.get('doctor')) || patient.data?.default_doctor_id || null);
      setLines([blankLine()]);
      setBase(JSON.stringify({ l: [], plan }));
    } else if (doc.data) {
      const d = doc.data;
      const ls = toEdit(d);
      setLines(ls);
      setDoctorId(d.doctor_id);
      setNotes(d.notes);
      setUseIns(d.insurance !== null);
      setClassId(d.insurance?.class_id ?? null);
      setBase(JSON.stringify(snapshot(ls, d.doctor_id, d.notes, d.insurance !== null, d.insurance?.class_id ?? null)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data, isNew, patient.data?.id]);

  const editable = can('quotation.edit') && (isNew || (doc.data && ['draft', 'sent'].includes(doc.data.status)));
  const apiLines = lines.filter((l) => l.service_id || l.description_ar.trim()).map(toApi);
  const insuranceChoice = { use_insurance: useIns, class_id: classId };
  const [debounced] = useDebouncedValue(JSON.stringify({ apiLines, insuranceChoice }), 300);
  const preview = useQuery({
    queryKey: ['billing', 'preview', patientId, debounced],
    queryFn: () => api<Preview>('/pricing/preview', { method: 'POST', body: { patient_id: patientId, lines: JSON.parse(debounced).apiLines, insurance: JSON.parse(debounced).insuranceChoice } }),
    enabled: !!patientId && JSON.parse(debounced).apiLines.length > 0 && !!editable,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const shown: Preview | BillingDoc | undefined = editable ? preview.data : doc.data;
  const dirty = editable && JSON.stringify(snapshot(lines, doctorId, notes, useIns, classId)) !== base && apiLines.length > 0;

  async function save(): Promise<BillingDoc | null> {
    setBusy(true);
    setError(null);
    try {
      const body = { doctor_id: doctorId, notes, lines: apiLines, insurance: insuranceChoice };
      const saved = isNew
        ? await api<BillingDoc>(path, { method: 'POST', body: { ...body, patient_id: patientId, plan_id: Number(params.get('plan')) || null } })
        : await api<BillingDoc>(`${path}/${id}`, { method: 'PATCH', body: { ...body, version: doc.data!.version } });
      qc.setQueryData(['billing', kind, String(saved.id)], saved);
      await qc.invalidateQueries({ queryKey: ['billing', 'list'] });
      // Mark as saved before navigating, or the unsaved-changes guard would block the move.
      flushSync(() => setBase(JSON.stringify(snapshot(lines, doctorId, notes, useIns, classId))));
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      if (isNew) navigate(`/billing/${kind === 'quotation' ? 'quotation' : 'payment-order'}/${saved.id}`, { replace: true });
      return saved;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function action(name: string, extra: object = {}, saved?: BillingDoc) {
    // `saved` is the document just created by save(): this closure still sees the old dirty state.
    let d = saved ?? doc.data;
    if (!saved && dirty) d = (await save()) ?? undefined;
    if (!d) return;
    try {
      const url = name === 'convert' ? `/quotations/${d.id}/convert` : `${path}/${d.id}/${name}`;
      const res = await api<BillingDoc>(url, { method: 'POST', body: { version: d.version, ...extra } });
      await qc.invalidateQueries({ queryKey: ['billing'] });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t(`billing.done.${name}`) });
      if (name === 'convert') navigate(`/billing/payment-order/${res.id}`);
    } catch (e) {
      setError(e);
    }
  }

  const guard = useUnsavedGuard(!!dirty, async () => !!(await save()));
  const svcOptions = useMemo(() => (services.data ?? []).map((s) => ({ value: String(s.id), label: `${s.code} · ${nameOf(s, lang)}` })), [services.data, lang]);
  const pt = patient.data;
  const patientClasses = (classes.data ?? []).filter((c) => c.company_id === pt?.insurance?.company_id);
  const set = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickService = (key: string, v: string | null) => {
    const s = services.data?.find((x) => String(x.id) === v);
    set(key, { service_id: s ? s.id : null, price: s ? s.sale_price : '0', description_ar: s?.name_ar ?? '', description_en: s?.name_en ?? '' });
  };

  if (!isNew && doc.isPending) return <Skeleton height={400} />;
  if (!isNew && doc.isError) return <Alert color="red">{errorMessage(t, doc.error, lang)}</Alert>;
  const d = doc.data;
  const number = d?.quotation_no ?? d?.order_no;
  const fm = (v: string | undefined) => (v ? formatMoney(v, lang, digits) : '—');
  const ins = shown?.insurance ?? null;

  return (
    <Stack maw={1300} data-testid="document-editor">
      {guard}
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={1}>{t(`billing.kinds.${kind}`)}</Title>
          {number && (
            <Badge size="lg" variant="light" data-testid="doc-number">
              {number}
            </Badge>
          )}
          {d && <Badge color={STATUS_COLOR[d.status]}>{t(`billing.status.${d.status}`)}</Badge>}
        </Group>
        {d && (
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => void printDoc(`/print/billing/${kind}/${d.id}`)}>
            {t('print.print')}
          </Button>
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card>
          <Stack gap="xs">
            <Text size="sm">
              {t('appointments.patient')}:{' '}
              {pt ? (
                <Link to={`/patients/${pt.id}/billing`}>
                  <b>{nameOf(pt, lang)}</b> · {pt.file_no}
                </Link>
              ) : (
                '—'
              )}
            </Text>
            <Select
              label={t('appointments.doctor')}
              data={(doctors.data ?? []).map((x) => ({ value: String(x.id), label: nameOf(x, lang) }))}
              value={doctorId ? String(doctorId) : null}
              onChange={(v) => setDoctorId(v ? Number(v) : null)}
              disabled={!editable}
              clearable
            />
            {d && (
              <Text size="xs" c="dimmed">
                {t('appointments.createdBy', { name: d.created_by_name ?? '—' })} · {formatDate(d.created_at, lang, digits)}
                {d.valid_until ? ` · ${t('billing.validUntil', { date: formatDate(d.valid_until, lang, digits) })}` : ''}
                {d.sent_at ? ` · ${t('billing.sentBy', { name: d.sent_by_name ?? '' })}` : ''}
              </Text>
            )}
            <Textarea label={t('sample.note')} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} readOnly={!editable} autosize minRows={1} />
          </Stack>
        </Card>
        <Card data-testid="insurance-panel">
          <Group justify="space-between" mb="xs">
            <Group gap={6}>
              <IconShieldCheck size={18} />
              <Text fw={600}>{t('patients.insurance')}</Text>
            </Group>
            {editable && pt?.insurance && <Switch label={t('billing.useInsurance')} checked={useIns} onChange={(e) => setUseIns(e.currentTarget.checked)} data-testid="use-insurance" />}
          </Group>
          {ins ? (
            <SimpleGrid cols={2} spacing={4}>
              <Info label={t('patients.fields.ins_company_id')} value={nameOf({ name_ar: ins.company_name_ar ?? '', name_en: ins.company_name_en ?? '' }, lang)} />
              {editable && can('invoice.price_override') && patientClasses.length > 0 ? (
                <Select size="xs" label={t('patients.fields.ins_class_name')} data={patientClasses.map((c) => ({ value: String(c.id), label: c.name }))} value={String(ins.class_id ?? '')} onChange={(v) => setClassId(v ? Number(v) : null)} />
              ) : (
                <Info label={t('patients.fields.ins_class_name')} value={ins.class_name} />
              )}
              <Info label={t('patients.fields.ins_policy_no')} value={ins.policy_no} />
              <Info label={t('patients.fields.ins_membership_no')} value={ins.membership_no} />
              <Info label={t('billing.patientSharePct')} value={ins.patient_share_pct ? `${ins.patient_share_pct}%` : '—'} />
              <Info label={t('billing.maxPerInvoice')} value={fm(ins.max_patient_share_per_invoice ?? undefined)} />
              <Info label={t('billing.consultationLimit')} value={fm(ins.consultation_max_covered ?? undefined)} />
              <Info label={t('billing.dailyLimit')} value={fm(ins.daily_limit ?? undefined)} />
              <Info label={t('patients.fields.ins_expiry')} value={ins.expiry ? formatDate(ins.expiry, lang, digits) : '—'} />
            </SimpleGrid>
          ) : (
            <Text size="sm" c="dimmed">
              {t('patients.cash')}
            </Text>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            {shown && 'saudi' in shown && shown.saudi ? t('billing.saudiVat') : t('billing.vatApplies')}
          </Text>
        </Card>
      </SimpleGrid>

      {error !== null && (
        <Alert color="red" variant="light" icon={<IconX size={16} />}>
          {error instanceof ApiError && error.code === 'price_out_of_range'
            ? t('billing.priceRange', { min: fm(error.detail?.min as string), max: fm(error.detail?.max as string) })
            : errorMessage(t, error, lang)}
        </Alert>
      )}
      {preview.isError && editable && (
        <Alert color="yellow" variant="light">
          {preview.error instanceof ApiError && preview.error.code === 'price_out_of_range'
            ? t('billing.priceRange', { min: fm(preview.error.detail?.min as string), max: fm(preview.error.detail?.max as string) })
            : errorMessage(t, preview.error, lang)}
        </Alert>
      )}
      {editable && preview.data && preview.data.notes.length > 0 && (
        <Alert color="blue" variant="light" data-testid="pricing-notes">
          {preview.data.notes.map((n) => t(`billing.notes.${n}`, { defaultValue: n })).join(' · ')}
        </Alert>
      )}

      <Card padding={0}>
        <Table.ScrollContainer minWidth={1000}>
          <Table data-testid="doc-lines">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={220}>{t('appointments.service')}</Table.Th>
                <Table.Th w={105}>{t('billing.price')}</Table.Th>
                <Table.Th w={55}>{t('billing.qty')}</Table.Th>
                <Table.Th w={150}>{t('billing.discount')}</Table.Th>
                <Table.Th w={70}>{t('dental.teeth')}</Table.Th>
                <Table.Th ta="end">{t('services.vat')}</Table.Th>
                <Table.Th ta="end">{t('billing.lineTotal')}</Table.Th>
                <Table.Th ta="end">{t('billing.insuranceShare')}</Table.Th>
                <Table.Th ta="end">{t('billing.patientShare')}</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l, i) => {
                // Blank rows are not sent, so the n-th filled row matches the n-th calculated line.
                const filledIndex = lines.filter((x) => x.service_id || x.description_ar.trim()).indexOf(l);
                const calc = filledIndex >= 0 ? shown?.lines[filledIndex] : undefined;
                return (
                  <Table.Tr key={l.key} data-testid={`line-${i}`}>
                    <Table.Td>
                      {editable ? (
                        <Select data={svcOptions} value={l.service_id ? String(l.service_id) : null} onChange={(v) => pickService(l.key, v)} searchable placeholder={t('billing.searchService')} size="xs" data-testid={`line-service-${i}`} />
                      ) : (
                        <Text size="sm">{lang === 'ar' ? l.description_ar : l.description_en || l.description_ar}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <MoneyInput size="xs" value={l.price} onChange={(v) => set(l.key, { price: v })} disabled={!editable} rightSection={null} data-testid={`line-price-${i}`} />
                      {calc?.price_overridden && (
                        <Text size="xs" c="orange">
                          {t('billing.overridden')}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <NumberInput size="xs" value={l.qty} onChange={(v) => set(l.key, { qty: String(v || 1) })} min={1} disabled={!editable} hideControls dir="ltr" />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <NumberInput size="xs" value={l.discount} onChange={(v) => set(l.key, { discount: String(v === '' ? 0 : v) })} min={0} decimalScale={2} disabled={!editable} hideControls dir="ltr" w={64} />
                        <SegmentedControl size="xs" value={l.discount_mode} onChange={(v) => set(l.key, { discount_mode: v as 'amount' | 'pct' })} data={[{ value: 'pct', label: '%' }, { value: 'amount', label: t('currency') }]} disabled={!editable} />
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <TextInput size="xs" value={l.teeth} onChange={(e) => set(l.key, { teeth: e.currentTarget.value })} disabled={!editable} dir="ltr" placeholder="11 21" />
                    </Table.Td>
                    <Table.Td ta="end" fz="sm">
                      {calc ? (
                        <Tooltip label={`${calc.vat_rate}%`}>
                          <span>{fm(calc.vat_amount)}</span>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </Table.Td>
                    <Table.Td ta="end" fz="sm" fw={500}>
                      {fm(calc?.line_total)}
                    </Table.Td>
                    <Table.Td ta="end" fz="sm" c="teal">
                      {fm(calc?.insurance_share)}
                    </Table.Td>
                    <Table.Td ta="end" fz="sm" fw={600}>
                      {fm(calc?.patient_share)}
                    </Table.Td>
                    <Table.Td>
                      {editable && (
                        <ActionIcon variant="subtle" color="red" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blankLine()]))} aria-label={t('common.delete')}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {editable && (
          <Group p="sm">
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setLines((ls) => [...ls, blankLine()])} data-testid="add-line">
              {t('billing.addLine')}
            </Button>
          </Group>
        )}
      </Card>

      <Group justify="space-between" align="flex-start">
        <Group gap="xs">
          {editable && (
            <Button variant="default" onClick={() => void save()} loading={busy} disabled={!dirty} data-testid="save-draft">
              {t('billing.saveDraft')}
            </Button>
          )}
          {kind === 'payment_order' && editable && (!d || d.status === 'draft') && (
            <Button leftSection={<IconSend size={16} />} onClick={() => void (d ? action('send') : save().then((x) => x && action('send', {}, x)))} loading={busy} disabled={apiLines.length === 0} data-testid="send-to-reception">
              {t('billing.sendToReception')}
            </Button>
          )}
          {kind === 'payment_order' && d?.status === 'sent' && can('payment.collect') && (
            <Button color="green" leftSection={<IconCash size={16} />} onClick={() => setCollecting(true)} data-testid="collect-order">
              {t('ledger.collect')}
            </Button>
          )}
          {kind === 'payment_order' && d?.status === 'paid' && d.invoice_id && (
            <Button variant="light" component={Link} to={`/billing/invoice/${d.invoice_id}`} leftSection={<IconFileInvoice size={16} />} data-testid="open-invoice">
              {t('ledger.invoice')} <span dir="ltr" style={{ marginInlineStart: 4 }}>{d.invoice_no}</span>
            </Button>
          )}
          {kind === 'quotation' && d && can('quotation.edit') && ['draft', 'sent', 'accepted'].includes(d.status) && (
            <>
              {d.status === 'draft' && <Button variant="light" onClick={() => void action('send')}>{t('billing.markSent')}</Button>}
              {d.status !== 'accepted' && <Button variant="light" color="green" onClick={() => void action('accept')}>{t('billing.accept')}</Button>}
              <Button leftSection={<IconFileInvoice size={16} />} onClick={() => void action('convert')} data-testid="convert">
                {t('billing.convert')}
              </Button>
            </>
          )}
          {d && can('quotation.edit') && ['draft', 'sent'].includes(d.status) && (
            <Button variant="subtle" color="red" onClick={() => void action('cancel')}>
              {t('common.cancel')}
            </Button>
          )}
          <Tooltip label={t('common.comingSoon')}>
            <span>
              <Button variant="subtle" disabled>
                {t('billing.signature')}
              </Button>
            </span>
          </Tooltip>
        </Group>
        <Card w={320} data-testid="summary">
          <Stack gap={4}>
            <Row label={t('billing.gross')} value={fm(shown?.gross)} />
            <Row label={t('billing.discounts')} value={fm(shown?.discount)} />
            <Row label={t('billing.netBeforeVat')} value={fm(shown?.net)} />
            <Row label={t('services.vat')} value={fm(shown?.vat)} />
            <Row label={t('billing.total')} value={fm(shown?.total)} bold />
            <Row label={t('billing.insuranceShare')} value={fm(shown?.insurance_share)} />
            <Row label={t('billing.patientDue')} value={fm(shown?.patient_share)} bold testid="patient-due" />
          </Stack>
        </Card>
      </Group>
      <CollectModal order={collecting && d ? d : null} onClose={() => setCollecting(false)} />
    </Stack>
  );
}

function snapshot(lines: EditLine[], doctorId: number | null, notes: string, useIns: boolean, classId: number | null) {
  return { l: lines.filter((l) => l.service_id || l.description_ar.trim()).map(toApi), doctorId, notes, useIns, classId };
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{value || '—'}</Text>
    </div>
  );
}

function Row({ label, value, bold, testid }: { label: string; value: string; bold?: boolean; testid?: string }) {
  return (
    <Group justify="space-between">
      <Text size="sm" fw={bold ? 700 : 400}>
        {label}
      </Text>
      <Text size="sm" fw={bold ? 700 : 400} data-testid={testid}>
        {value}
      </Text>
    </Group>
  );
}
