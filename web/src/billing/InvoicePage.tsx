import { ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, Group, Modal, NumberInput, Radio, Select, SimpleGrid, Skeleton, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { IconArrowBackUp, IconCash, IconLock, IconPencil, IconPlus, IconPrinter, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatMoney } from '../lib/format';
import { fromCents, toCents } from '../lib/money';
import { nameOf, useServices } from '../master/queries';
import { openPrint, Stat } from './CollectModal';
import type { CreditNote, Invoice } from './ledgerTypes';
import { PayBalanceModal } from './AccountPanel';
import { paymentRow, PaymentRows, rowsTotal, toPayments } from './PaymentRows';

/** A final invoice: read-only forever; corrections only by credit note (SPEC 10.6). */
export function InvoicePage() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['invoices', 'one', id], queryFn: () => api<Invoice>(`/invoices/${id}`) });
  const [crediting, setCrediting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const fm = (v: string) => formatMoney(v, lang, digits);
  if (q.isPending) return <Skeleton height={400} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  const inv = q.data;
  const creditable = inv.lines.some((l) => toCents(l.credited_qty) < toCents(l.qty));
  return (
    <Stack data-testid="invoice-page">
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={1}>
            {t('ledger.invoice')} <span dir="ltr">{inv.invoice_no}</span>
          </Title>
          <Badge color={toCents(inv.outstanding) > 0 ? 'orange' : 'green'} data-testid="invoice-state">
            {toCents(inv.outstanding) > 0 ? t('ledger.outstanding', { amount: fm(inv.outstanding) }) : t('ledger.settled')}
          </Badge>
          <Badge variant="light" color="neutral" leftSection={<IconLock size={12} />}>
            {t('ledger.final')}
          </Badge>
        </Group>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => openPrint(`/print/invoice/${inv.id}`)}>
            {t('print.print')}
          </Button>
          {can('payment.collect') && toCents(inv.outstanding) > 0 && (
            <Button leftSection={<IconCash size={16} />} onClick={() => setPaying(true)} data-testid="pay-invoice">
              {t('ledger.payBalance')}
            </Button>
          )}
          {can('invoice.correct') && creditable && Number(inv.portion) >= 1 && inv.corrected_by.length === 0 && (
            <Button variant="light" leftSection={<IconPencil size={16} />} onClick={() => setCorrecting(true)} data-testid="correct-invoice">
              {t('ledger.correct')}
            </Button>
          )}
          {can('invoice.credit_note') && creditable && (
            <Button variant="light" color="red" leftSection={<IconArrowBackUp size={16} />} onClick={() => setCrediting(true)} data-testid="credit-note">
              {t('ledger.creditNote')}
            </Button>
          )}
        </Group>
      </Group>
      {(Number(inv.portion) < 1 || inv.corrects_invoice_no || inv.corrected_by.length > 0) && (
        <Alert color="blue" variant="light" data-testid="invoice-links">
          <Stack gap={2}>
            {Number(inv.portion) < 1 && <Text size="sm">{t('ledger.partOf', { no: inv.order_no ?? '', pct: (Number(inv.portion) * 100).toFixed(1) })}</Text>}
            {inv.corrects_invoice_id && (
              <Text size="sm">
                {t('ledger.corrects', { no: '' })}
                <Anchor component={Link} to={`/billing/invoice/${inv.corrects_invoice_id}`} dir="ltr">
                  {inv.corrects_invoice_no}
                </Anchor>
              </Text>
            )}
            {inv.corrected_by.length > 0 && (
              <Text size="sm">
                {t('ledger.correctedBy')}:{' '}
                {inv.corrected_by.map((c) => (
                  <Anchor key={c.id} component={Link} to={`/billing/invoice/${c.id}`} dir="ltr" me="xs">
                    {c.invoice_no}
                  </Anchor>
                ))}
              </Text>
            )}
          </Stack>
        </Alert>
      )}
      <Card>
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Stat label={t('appointments.patient')} value={`${nameOf({ name_ar: inv.buyer_name_ar, name_en: inv.buyer_name_en }, lang)} · ${inv.buyer_file_no}`} />
          <Stat label={t('ledger.issuedAt')} value={formatDateTime(inv.issued_at, lang, digits)} />
          <Stat label={t('ledger.issuedBy')} value={inv.issued_by_name ?? '—'} />
          <Stat label={t('appointments.doctor')} value={inv.doctor_name_ar ?? '—'} />
          <Stat label={t('patients.insurance')} value={inv.insurance ? `${nameOf({ name_ar: inv.insurance.company_name_ar ?? '', name_en: inv.insurance.company_name_en ?? '' }, lang)} (${inv.insurance.class_name})` : t('ledger.cash')} />
          <Stat label={t('ledger.fromOrder')} value={inv.order_no ?? '—'} />
          <Stat label={t('ledger.vatStatus')} value={inv.saudi ? t('ledger.saudiExempt') : t('ledger.vatCharged')} />
          <Stat label="UUID" value={inv.uuid.slice(0, 13) + '…'} />
        </SimpleGrid>
      </Card>
      <Card padding={0}>
        <Table.ScrollContainer minWidth={850}>
          <Table data-testid="invoice-lines">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('appointments.service')}</Table.Th>
                <Table.Th ta="end">{t('billing.qty')}</Table.Th>
                <Table.Th ta="end">{t('billing.price')}</Table.Th>
                <Table.Th ta="end">{t('billing.discount')}</Table.Th>
                <Table.Th ta="end">VAT</Table.Th>
                <Table.Th ta="end">{t('billing.lineTotal')}</Table.Th>
                <Table.Th ta="end">{t('billing.insuranceShare')}</Table.Th>
                <Table.Th ta="end">{t('billing.patientShare')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {inv.lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    {lang === 'ar' ? l.description_ar : l.description_en || l.description_ar}
                    {l.teeth.length > 0 && (
                      <Text span size="xs" c="dimmed" ms={6}>
                        {l.teeth.join(' ')}
                      </Text>
                    )}
                    {toCents(l.credited_qty) > 0 && (
                      <Badge size="xs" color="red" variant="light" ms={6}>
                        {t('ledger.creditedQty', { qty: l.credited_qty })}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="end">{l.qty}</Table.Td>
                  <Table.Td ta="end">{fm(l.price)}</Table.Td>
                  <Table.Td ta="end">{fm(l.discount)}</Table.Td>
                  <Table.Td ta="end">
                    {fm(l.vat_amount)}{' '}
                    <Text span size="xs" c="dimmed">
                      {l.vat_rate}%
                    </Text>
                  </Table.Td>
                  <Table.Td ta="end">{fm(l.line_total)}</Table.Td>
                  <Table.Td ta="end">{fm(l.insurance_share)}</Table.Td>
                  <Table.Td ta="end">{fm(l.patient_share)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Card>
          <Stack gap={4}>
            <Row label={t('billing.netBeforeVat')} value={fm(inv.net)} />
            <Row label="VAT" value={fm(inv.vat)} />
            <Row label={t('billing.total')} value={fm(inv.total)} strong />
            <Row label={t('billing.insuranceShare')} value={fm(inv.insurance_share)} />
            <Row label={t('billing.patientShare')} value={fm(inv.patient_share)} strong />
            {toCents(inv.credited) > 0 && <Row label={t('ledger.credited')} value={fm(inv.credited)} />}
            <Row label={t('ledger.outstandingLabel')} value={fm(inv.outstanding)} strong testid="invoice-outstanding" />
          </Stack>
        </Card>
        <Card>
          <Text fw={600} mb="xs">
            {t('ledger.receipts')}
          </Text>
          {inv.receipts.length === 0 && (
            <Text size="sm" c="dimmed">
              {t('ledger.noReceipts')}
            </Text>
          )}
          {inv.receipts.map((r) => (
            <Group key={`${r.id}-${r.kind}`} justify="space-between" gap={4}>
              <Anchor size="sm" onClick={() => openPrint(`/print/receipt/${r.id}`)} dir="ltr">
                {r.receipt_no}
              </Anchor>
              <Text size="sm">
                {t(`ledger.kinds.${r.kind}`)} · {r.kind === 'refund' ? '−' : ''}
                {fm(r.amount)}
              </Text>
            </Group>
          ))}
        </Card>
        <Card>
          <Text fw={600} mb="xs">
            {t('ledger.creditNotes')}
          </Text>
          {inv.credit_notes.length === 0 && (
            <Text size="sm" c="dimmed">
              {t('ledger.noCreditNotes')}
            </Text>
          )}
          {inv.credit_notes.map((c) => (
            <Stack key={c.id} gap={0} mb={4}>
              <Group justify="space-between">
                <Anchor size="sm" onClick={() => openPrint(`/print/credit-note/${c.id}`)} dir="ltr">
                  {c.credit_note_no}
                </Anchor>
                <Text size="sm">{fm(c.total)}</Text>
              </Group>
              <Text size="xs" c="dimmed">
                {c.reason}
              </Text>
            </Stack>
          ))}
        </Card>
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        <Link to={`/patients/${inv.patient_id}/billing`}>{t('ledger.patientAccount')}</Link>
      </Text>
      {crediting && <CreditNoteModal invoice={inv} onClose={() => setCrediting(false)} />}
      {correcting && <CorrectInvoiceModal invoice={inv} onClose={() => setCorrecting(false)} />}
      <PayBalanceModal opened={paying} patientId={inv.patient_id} invoice={inv} onClose={() => setPaying(false)} />
    </Stack>
  );
}

function Row({ label, value, strong, testid }: { label: string; value: string; strong?: boolean; testid?: string }) {
  return (
    <Group justify="space-between">
      <Text size="sm" c={strong ? undefined : 'dimmed'}>
        {label}
      </Text>
      <Text size="sm" fw={strong ? 700 : 400} data-testid={testid}>
        {value}
      </Text>
    </Group>
  );
}

/** Credit note for chosen line quantities (SPEC 10.6). The server decides the exact split. */
function CreditNoteModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const qc = useQueryClient();
  const fm = (v: string) => formatMoney(v, lang, digits);
  const open = invoice.lines.filter((l) => toCents(l.credited_qty) < toCents(l.qty));
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'refund' | 'deposit'>('refund');
  const [rows, setRows] = useState(() => [paymentRow('cash')]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CreditNote | null>(null);

  // Estimate of the patient's part (the server recalculates exactly).
  const patientPart = useMemo(
    () =>
      fromCents(
        open.reduce((s, l) => {
          const qty = picked[l.id];
          if (!qty) return s;
          return s + Math.round((toCents(l.patient_share) * toCents(qty)) / toCents(l.qty));
        }, 0),
      ),
    [open, picked],
  );
  const toReturn = fromCents(Math.max(0, toCents(patientPart) - Math.max(0, toCents(invoice.outstanding))));
  const needsRefund = toCents(toReturn) > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const lines = Object.entries(picked)
      .filter(([, q]) => q && toCents(q) > 0)
      .map(([id, qty]) => ({ invoice_line_id: Number(id), qty }));
    const body = {
      reason,
      lines,
      refund: needsRefund ? (mode === 'deposit' ? { to_deposit: true } : { payments: toPayments(rows) }) : null,
    };
    try {
      const cn = await api<CreditNote>(`/invoices/${invoice.id}/credit-notes`, { method: 'POST', body });
      setDone(cn);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['account', invoice.patient_id] });
      void qc.invalidateQueries({ queryKey: ['cashbox'] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'refund_amount_mismatch' && typeof e.detail?.due === 'string') {
        setRows([paymentRow('cash', e.detail.due)]);
        setError(t('ledger.refundDue', { amount: fm(e.detail.due) }));
      } else setError(errorMessage(t, e, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={t('ledger.creditNoteFor', { no: invoice.invoice_no })} size="lg" closeOnClickOutside={false}>
      {done ? (
        <Stack data-testid="credit-done">
          <Alert color="green" title={t('ledger.creditIssued')}>
            <b dir="ltr">{done.credit_note_no}</b> · {fm(done.total)}
            {toCents(done.refunded) > 0 && <Text size="sm">{mode === 'deposit' ? t('ledger.keptOnAccount', { amount: fm(done.refunded) }) : t('ledger.refunded', { amount: fm(done.refunded) })}</Text>}
          </Alert>
          <Group>
            <Button leftSection={<IconPrinter size={16} />} onClick={() => openPrint(`/print/credit-note/${done.id}`)}>
              {t('ledger.printCreditNote')}
            </Button>
            {done.refund_receipt_id && (
              <Button variant="light" onClick={() => openPrint(`/print/receipt/${done.refund_receipt_id}`)}>
                {t('ledger.printReceipt')}
              </Button>
            )}
            <Button variant="subtle" onClick={onClose} ms="auto">
              {t('common.close')}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {t('ledger.creditHint')}
            </Text>
            <Button size="xs" variant="subtle" onClick={() => setPicked(Object.fromEntries(open.map((l) => [l.id, fromCents(toCents(l.qty) - toCents(l.credited_qty))])))} data-testid="credit-all">
              {t('ledger.creditAll')}
            </Button>
          </Group>
          {open.map((l) => {
            const left = fromCents(toCents(l.qty) - toCents(l.credited_qty));
            return (
              <Group key={l.id} justify="space-between" wrap="nowrap">
                <Checkbox
                  label={`${lang === 'ar' ? l.description_ar : l.description_en || l.description_ar} · ${fm(l.line_total)}`}
                  checked={!!picked[l.id]}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setPicked((p) => {
                      const next = { ...p };
                      if (on) next[l.id] = left;
                      else delete next[l.id];
                      return next;
                    });
                  }}
                  data-testid={`credit-line-${l.seq}`}
                />
                <NumberInput w={90} size="xs" value={picked[l.id] ?? ''} min={0} max={Number(left)} decimalScale={2} disabled={!picked[l.id]} onChange={(v) => setPicked((p) => ({ ...p, [l.id]: String(v || '') }))} hideControls dir="ltr" aria-label={t('billing.qty')} />
              </Group>
            );
          })}
          <Textarea label={t('ledger.reason')} required value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={1000} autosize minRows={2} data-testid="credit-reason" />
          <Text size="sm">
            {t('ledger.patientPart')}: <b>{fm(patientPart)}</b>
          </Text>
          {needsRefund && (
            <Card withBorder>
              <Stack gap="xs">
                <Text size="sm">{t('ledger.alreadyPaid', { amount: fm(toReturn) })}</Text>
                <Radio.Group value={mode} onChange={(v) => setMode(v as 'refund' | 'deposit')}>
                  <Group>
                    <Radio value="refund" label={t('ledger.refundNow')} />
                    <Radio value="deposit" label={t('ledger.keepOnAccount')} data-testid="keep-on-account" />
                  </Group>
                </Radio.Group>
                {mode === 'refund' && <PaymentRows rows={rows} onChange={setRows} allowDeposit={false} due={toReturn} />}
                {mode === 'refund' && toCents(rowsTotal(rows)) !== toCents(toReturn) && (
                  <Text size="xs" c="orange">
                    {t('ledger.refundShouldBe', { amount: fm(toReturn) })}
                  </Text>
                )}
              </Stack>
            </Card>
          )}
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button color="red" onClick={() => void submit()} loading={busy} disabled={reason.trim().length < 3 || toCents(patientPart) + Object.keys(picked).length === 0} data-testid="confirm-credit">
              {t('ledger.issueCreditNote')}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

interface CorrectLine {
  key: number;
  service_id: number | null;
  description_ar: string;
  price: string;
  qty: string;
  discount: string;
}

/** A manager fixes an issued invoice: credit note + corrected invoice paid from the credit. */
function CorrectInvoiceModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const services = useServices();
  const [lines, setLines] = useState<CorrectLine[]>(() =>
    invoice.lines.map((l, i) => ({ key: i, service_id: l.service_id, description_ar: l.description_ar, price: l.price, qty: l.qty, discount: l.discount })),
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ credit_note: CreditNote; invoice: Invoice | null; remaining: string } | null>(null);
  const set = (key: number, patch: Partial<CorrectLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const options = (services.data ?? []).map((s) => ({ value: String(s.id), label: `${s.code} · ${nameOf(s, lang)}` }));
  const valid = reason.trim().length >= 3 && lines.length > 0 && lines.every((l) => (l.service_id || l.description_ar.trim()) && Number(l.qty) > 0 && Number(l.price) >= 0);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ credit_note: CreditNote; invoice: Invoice | null; remaining: string }>(`/invoices/${invoice.id}/correct`, {
        method: 'POST',
        body: {
          reason,
          lines: lines.map((l) => ({ service_id: l.service_id, description_ar: l.description_ar, price: l.price || '0', qty: l.qty || '1', discount_amount: l.discount || '0', discount_pct: '0' })),
        },
      });
      setDone(res);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['account', invoice.patient_id] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title={t('ledger.correctTitle', { no: invoice.invoice_no })} size="xl" closeOnClickOutside={false}>
      {done ? (
        <Stack data-testid="correct-done">
          <Alert color="green" title={t('ledger.correctDone')}>
            <Text size="sm">{t('ledger.correctDoneHint', { cn: done.credit_note.credit_note_no, inv: done.invoice?.invoice_no ?? '—' })}</Text>
            {toCents(done.remaining) > 0 && <Text size="sm">{t('ledger.billRemaining', { amount: formatMoney(done.remaining, lang, digits) })}</Text>}
          </Alert>
          <Group justify="flex-end">
            {done.invoice && (
              <Button
                onClick={() => {
                  onClose();
                  navigate(`/billing/invoice/${done.invoice!.id}`);
                }}
                data-testid="open-corrected"
              >
                {t('ledger.openInvoice')}
              </Button>
            )}
            <Button variant="default" onClick={onClose}>
              {t('common.close')}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Alert color="blue" variant="light">
            <Text size="sm">{t('ledger.correctHint')}</Text>
          </Alert>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('ledger.service')}</Table.Th>
                <Table.Th w={110}>{t('billing.price')}</Table.Th>
                <Table.Th w={80}>{t('billing.qty')}</Table.Th>
                <Table.Th w={110}>{t('billing.discount')}</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l, i) => (
                <Table.Tr key={l.key} data-testid={`correct-line-${i}`}>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={options}
                      value={l.service_id ? String(l.service_id) : null}
                      onChange={(v) => {
                        const s = services.data?.find((x) => String(x.id) === v);
                        set(l.key, { service_id: s ? s.id : null, description_ar: s?.name_ar ?? l.description_ar, price: s ? s.sale_price : l.price });
                      }}
                      searchable
                      placeholder={l.description_ar}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={l.price} onChange={(v) => set(l.key, { price: String(v) })} min={0} decimalScale={2} hideControls dir="ltr" data-testid={`correct-price-${i}`} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={l.qty} onChange={(v) => set(l.key, { qty: String(v) })} min={0.01} decimalScale={2} hideControls dir="ltr" />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={l.discount} onChange={(v) => set(l.key, { discount: String(v) })} min={0} decimalScale={2} hideControls dir="ltr" />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('common.delete')}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Button variant="subtle" w="fit-content" leftSection={<IconPlus size={14} />} onClick={() => setLines((ls) => [...ls, { key: Date.now(), service_id: null, description_ar: '', price: '0', qty: '1', discount: '0' }])}>
            {t('ledger.addLine')}
          </Button>
          <Textarea label={t('ledger.reason')} value={reason} onChange={(e) => setReason(e.currentTarget.value)} required minLength={3} maxLength={1000} data-testid="correct-reason" />
          {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!valid} data-testid="confirm-correct">
              {t('ledger.correct')}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
