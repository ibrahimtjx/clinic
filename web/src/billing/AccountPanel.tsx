import { Alert, Anchor, Badge, Button, Card, Group, Modal, SimpleGrid, Skeleton, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { IconCash, IconPigMoney, IconReceiptRefund, IconSearch } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import { subMoney, toCents } from '../lib/money';
import { nameOf } from '../master/queries';
import { CollectModal, openPrint, Stat } from './CollectModal';
import type { Account, Invoice, Receipt, UnpaidOrder } from './ledgerTypes';
import type { BillingDoc } from './types';
import { paymentRow, PaymentRows, rowsTotal, toPayments } from './PaymentRows';

/** Balance, money on account, unpaid invoices and recent receipts for one patient (SPEC 10.5). */
export function AccountPanel({ patientId }: { patientId: number }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['account', patientId], queryFn: () => api<Account>(`/patients/${patientId}/account`) });
  const [modal, setModal] = useState<'pay' | 'deposit' | 'refund' | null>(null);
  const fm = (v: string) => formatMoney(v, lang, digits);
  if (q.isPending) return <Skeleton height={120} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  const a = q.data;
  return (
    <Stack data-testid="account-panel">
      <Card>
        <Group justify="space-between" align="flex-start">
          <SimpleGrid cols={2} spacing="xl">
            <Stat label={t('ledger.balance')} value={fm(a.balance)} strong testid="account-balance" />
            <Stat label={t('ledger.onAccount')} value={fm(a.deposit_balance)} strong testid="account-deposit" />
          </SimpleGrid>
          {can('payment.collect') && (
            <Group gap="xs">
              <Button leftSection={<IconCash size={16} />} disabled={toCents(a.balance) <= 0} onClick={() => setModal('pay')} data-testid="pay-balance">
                {t('ledger.payBalance')}
              </Button>
              <Button variant="light" leftSection={<IconPigMoney size={16} />} onClick={() => setModal('deposit')} data-testid="take-deposit">
                {t('ledger.takeDeposit')}
              </Button>
              {can('invoice.credit_note') && toCents(a.deposit_balance) > 0 && (
                <Button variant="subtle" color="red" leftSection={<IconReceiptRefund size={16} />} onClick={() => setModal('refund')}>
                  {t('ledger.refundDeposit')}
                </Button>
              )}
            </Group>
          )}
        </Group>
      </Card>
      {(a.unpaid_orders ?? []).length > 0 && <UnpaidBills account={a} />}
      {a.unpaid.length > 0 && (
        <Card padding={0}>
          <Text fw={600} p="sm">
            {t('ledger.unpaidInvoices')}
          </Text>
          <InvoiceTable invoices={a.unpaid} compact />
        </Card>
      )}
      <Card padding={0}>
        <Text fw={600} p="sm">
          {t('ledger.receipts')}
        </Text>
        <ReceiptTable receipts={a.receipts} />
      </Card>
      <PayBalanceModal opened={modal === 'pay'} patientId={patientId} account={a} onClose={() => setModal(null)} />
      <MoneyModal kind="deposit" opened={modal === 'deposit'} patientId={patientId} onClose={() => setModal(null)} />
      <MoneyModal kind="refund" opened={modal === 'refund'} patientId={patientId} max={a.deposit_balance} onClose={() => setModal(null)} />
    </Stack>
  );
}

export function PayBalanceModal({ opened, patientId, account, invoice, onClose }: { opened: boolean; patientId: number; account?: Account; invoice?: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const acct = useQuery({ queryKey: ['account', patientId], queryFn: () => api<Account>(`/patients/${patientId}/account`), enabled: opened && !account });
  const a = account ?? acct.data;
  const due = invoice ? invoice.outstanding : a?.balance ?? '0.00';
  return (
    <Modal opened={opened} onClose={onClose} title={invoice ? t('ledger.payInvoice', { no: invoice.invoice_no }) : t('ledger.payBalance')} size="lg" closeOnClickOutside={false}>
      {opened && a && <MoneyForm key={`${invoice?.id}-${due}`} kind="pay" patientId={patientId} due={due} deposit={a.deposit_balance} invoiceIds={invoice ? [invoice.id] : undefined} onClose={onClose} />}
    </Modal>
  );
}

function MoneyModal({ kind, opened, patientId, max, onClose }: { kind: 'deposit' | 'refund'; opened: boolean; patientId: number; max?: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={kind === 'deposit' ? t('ledger.takeDeposit') : t('ledger.refundDeposit')} size="lg" closeOnClickOutside={false}>
      {opened && <MoneyForm kind={kind} patientId={patientId} due={max} onClose={onClose} />}
    </Modal>
  );
}

function MoneyForm({ kind, patientId, due, deposit, invoiceIds, onClose }: { kind: 'pay' | 'deposit' | 'refund'; patientId: number; due?: string; deposit?: string; invoiceIds?: number[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const qc = useQueryClient();
  const fm = (v: string) => formatMoney(v, lang, digits);
  const [rows, setRows] = useState(() => [paymentRow('cash', kind === 'deposit' ? '0.00' : due ?? '0.00')]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Receipt | null>(null);
  const total = rowsTotal(rows);
  const over = due !== undefined && kind !== 'deposit' && toCents(total) > toCents(due);
  const path = { pay: 'payments', deposit: 'deposits', refund: 'deposit-refunds' }[kind];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Receipt>(`/patients/${patientId}/${path}`, { method: 'POST', body: { payments: toPayments(rows), note, invoice_ids: invoiceIds } });
      setDone(r);
      void qc.invalidateQueries({ queryKey: ['account', patientId] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['cashbox'] });
    } catch (e) {
      setError(errorMessage(t, e, lang));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Stack data-testid="money-done">
        <Alert color="green" title={t('ledger.receiptIssued')}>
          <b dir="ltr">{done.receipt_no}</b> · {fm(done.total)}
          {done.balance_after && <Text size="sm">{t('ledger.balanceAfter', { balance: fm(done.balance_after), deposit: fm(done.deposit_after ?? '0.00') })}</Text>}
        </Alert>
        <Group>
          <Button onClick={() => openPrint(`/print/receipt/${done.id}`)} data-testid="print-receipt">
            {t('ledger.printReceipt')}
          </Button>
          <Button variant="subtle" onClick={onClose} ms="auto">
            {t('common.close')}
          </Button>
        </Group>
      </Stack>
    );
  return (
    <Stack>
      {due !== undefined && <Text size="sm">{kind === 'refund' ? t('ledger.onAccountNow', { amount: fm(due) }) : t('ledger.dueNow', { amount: fm(due) })}</Text>}
      {kind === 'deposit' && (
        <Text size="sm" c="dimmed">
          {t('ledger.depositHint')}
        </Text>
      )}
      <PaymentRows rows={rows} onChange={setRows} allowDeposit={kind === 'pay'} depositAvailable={deposit} due={kind === 'deposit' ? undefined : due} />
      {kind === 'pay' && due && !over && toCents(subMoney(due, total)) > 0 && (
        <Text size="sm" c="orange">
          {t('ledger.stillOwed', { amount: fm(subMoney(due, total)) })}
        </Text>
      )}
      {over && (
        <Text size="sm" c="red">
          {t('ledger.overpaid')}
        </Text>
      )}
      <Textarea label={kind === 'refund' ? t('ledger.reason') : t('sample.note')} required={kind === 'refund'} value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={1000} autosize minRows={1} data-testid="money-note" />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void submit()} loading={busy} disabled={over || toCents(total) <= 0 || (kind === 'refund' && note.trim().length < 3)} data-testid="confirm-money">
          {t('ledger.issueReceipt')}
        </Button>
      </Group>
    </Stack>
  );
}

export function InvoiceTable({ invoices, compact, showPatient }: { invoices: Invoice[]; compact?: boolean; showPatient?: boolean }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const navigate = useNavigate();
  const fm = (v: string) => formatMoney(v, lang, digits);
  if (!invoices.length) return <EmptyState icon={IconSearch} title={t('master.emptyTitle')} hint="" />;
  return (
    <Table.ScrollContainer minWidth={compact ? 600 : 900}>
      <Table highlightOnHover data-testid="invoice-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('ledger.invoiceNo')}</Table.Th>
            {showPatient && <Table.Th>{t('appointments.patient')}</Table.Th>}
            <Table.Th>{t('sample.date')}</Table.Th>
            <Table.Th ta="end">{t('billing.total')}</Table.Th>
            <Table.Th ta="end">{t('billing.patientShare')}</Table.Th>
            <Table.Th ta="end">{t('ledger.outstandingLabel')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {invoices.map((i) => (
            <Table.Tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/billing/invoice/${i.id}`)}>
              <Table.Td fw={500}>
                <span dir="ltr">{i.invoice_no}</span>
                {toCents(i.credited) > 0 && (
                  <Badge size="xs" color="red" variant="light" ms={6}>
                    {t('ledger.credited')}
                  </Badge>
                )}
              </Table.Td>
              {showPatient && (
                <Table.Td>
                  {nameOf({ name_ar: i.buyer_name_ar, name_en: i.buyer_name_en }, lang)}{' '}
                  <Text span size="xs" c="dimmed">
                    {i.buyer_file_no}
                  </Text>
                </Table.Td>
              )}
              <Table.Td fz="sm">{formatDate(i.issued_at, lang, digits)}</Table.Td>
              <Table.Td ta="end">{fm(i.total)}</Table.Td>
              <Table.Td ta="end">{fm(i.patient_share)}</Table.Td>
              <Table.Td ta="end" fw={600} c={toCents(i.outstanding) > 0 ? 'orange' : undefined}>
                {fm(i.outstanding)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export function ReceiptTable({ receipts }: { receipts: Receipt[] }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  if (!receipts.length)
    return (
      <Text size="sm" c="dimmed" p="sm">
        {t('ledger.noReceipts')}
      </Text>
    );
  return (
    <Table.ScrollContainer minWidth={700}>
      <Table data-testid="receipt-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('ledger.receiptNo')}</Table.Th>
            <Table.Th>{t('ledger.kind')}</Table.Th>
            <Table.Th>{t('sample.date')}</Table.Th>
            <Table.Th>{t('ledger.method')}</Table.Th>
            <Table.Th ta="end">{t('ledger.amount')}</Table.Th>
            <Table.Th>{t('ledger.receivedBy')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {receipts.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                <Anchor size="sm" onClick={() => openPrint(`/print/receipt/${r.id}`)} dir="ltr">
                  {r.receipt_no}
                </Anchor>
              </Table.Td>
              <Table.Td>
                <Badge variant="light" color={r.kind === 'refund' ? 'red' : r.kind === 'deposit' ? 'grape' : 'green'}>
                  {t(`ledger.kinds.${r.kind}`)}
                </Badge>
              </Table.Td>
              <Table.Td fz="sm">{formatDateTime(r.received_at, lang, digits)}</Table.Td>
              <Table.Td fz="sm">{r.payments.map((p) => (r.kind === 'refund' && p.method === 'deposit' ? t('ledger.toAccount') : t(`ledger.methods.${p.method}`))).join(' + ')}</Table.Td>
              <Table.Td ta="end">
                {r.kind === 'refund' && !r.payments.every((p) => p.method === 'deposit') ? '−' : ''}
                {formatMoney(r.total, lang, digits)}
              </Table.Td>
              <Table.Td fz="sm">{r.received_by_name}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/** All invoices with search (Billing → Invoices). */
export function InvoiceList({ patientId }: { patientId?: number }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [unpaid, setUnpaid] = useState(false);
  const q = useQuery({
    queryKey: ['invoices', 'list', patientId, debounced, unpaid],
    queryFn: () => api<Invoice[]>('/invoices', { query: { patient_id: patientId, q: debounced, unpaid } }),
  });
  return (
    <Stack>
      {!patientId && (
        <Group>
          <TextInput leftSection={<IconSearch size={16} />} placeholder={t('ledger.searchInvoices')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={320} data-testid="invoice-search" />
          <Button variant={unpaid ? 'filled' : 'default'} onClick={() => setUnpaid((u) => !u)}>
            {t('ledger.unpaidOnly')}
          </Button>
        </Group>
      )}
      <Card padding={0}>{q.isPending ? <Skeleton height={160} /> : q.isError ? <Alert color="red">{errorMessage(t, q.error, lang)}</Alert> : <InvoiceTable invoices={q.data} showPatient={!patientId} />}</Card>
    </Stack>
  );
}

/** Bills paid in part (or "pay later"): pay the rest, or close it with a reason (owner, 2026-11-18). */
function UnpaidBills({ account }: { account: Account }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [paying, setPaying] = useState<BillingDoc | null>(null);
  const [closing, setClosing] = useState<UnpaidOrder | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fm = (v: string) => formatMoney(v, lang, digits);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['account', account.patient_id] });
    void qc.invalidateQueries({ queryKey: ['billing'] });
  };
  return (
    <Card padding={0} data-testid="unpaid-bills">
      <Text fw={600} p="sm">
        {t('ledger.unpaidBills')}
      </Text>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('billing.number')}</Table.Th>
            <Table.Th>{t('sample.date')}</Table.Th>
            <Table.Th>{t('appointments.doctor')}</Table.Th>
            <Table.Th ta="end">{t('billing.patientDue')}</Table.Th>
            <Table.Th ta="end">{t('ledger.paid')}</Table.Th>
            <Table.Th ta="end">{t('ledger.remaining')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {account.unpaid_orders.map((o) => (
            <Table.Tr key={o.id} data-testid={`bill-${o.order_no}`}>
              <Table.Td dir="ltr">{o.order_no}</Table.Td>
              <Table.Td>{o.sent_at ? formatDate(o.sent_at, lang, digits) : '—'}</Table.Td>
              <Table.Td>{o.doctor_name_ar ?? '—'}</Table.Td>
              <Table.Td ta="end">{fm(o.patient_share)}</Table.Td>
              <Table.Td ta="end">{fm(o.paid_amount)}</Table.Td>
              <Table.Td ta="end" fw={600} c="orange">
                {fm(o.remaining)}
              </Table.Td>
              <Table.Td ta="end">
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  {can('payment.collect') && (
                    <Button size="xs" leftSection={<IconCash size={14} />} onClick={async () => setPaying(await api<BillingDoc>(`/payment-orders/${o.id}`))} data-testid={`pay-bill-${o.id}`}>
                      {t('ledger.pay')}
                    </Button>
                  )}
                  {can('invoice.credit_note') && (
                    <Button size="xs" variant="subtle" color="red" onClick={() => { setClosing(o); setReason(''); setError(null); }} data-testid={`close-bill-${o.id}`}>
                      {t('ledger.closeRest')}
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <CollectModal order={paying} onClose={() => { setPaying(null); refresh(); }} />
      <Modal opened={!!closing} onClose={() => setClosing(null)} title={closing ? t('ledger.closeRestTitle', { no: closing.order_no }) : ''}>
        {closing && (
          <Stack>
            <Text size="sm">{t('ledger.closeRestHint', { amount: fm(closing.remaining) })}</Text>
            <Textarea label={t('ledger.reason')} value={reason} onChange={(e) => setReason(e.currentTarget.value)} required minLength={3} maxLength={1000} data-testid="close-reason" />
            {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setClosing(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                color="red"
                loading={busy}
                disabled={reason.trim().length < 3}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/payment-orders/${closing.id}/close`, { method: 'POST', body: { version: closing.version, reason } });
                    setClosing(null);
                    refresh();
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
                data-testid="confirm-close"
              >
                {t('ledger.closeRest')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Card>
  );
}
