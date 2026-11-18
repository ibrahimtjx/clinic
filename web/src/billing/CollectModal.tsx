import { Alert, Button, Divider, Group, Modal, SimpleGrid, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconCash, IconCheck, IconFileInvoice, IconPrinter, IconReceipt } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { usePrefs } from '../app/preferences';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { subMoney, toCents } from '../lib/money';
import { printDoc } from '../lib/print';
import type { Account, Invoice, Receipt } from './ledgerTypes';
import { paymentRow, PaymentRows, rowsTotal, toPayments } from './PaymentRows';
import type { BillingDoc } from './types';

/** Print a document page: silently in the desktop app, via the preview in a browser. */
export const openPrint = (path: string) => void printDoc(path);

/** Reception takes payment for a payment order: issues the final invoice and receipt (SPEC 10.5). */
export function CollectModal({ order, onClose }: { order: BillingDoc | null; onClose: () => void }) {
  return (
    <Modal opened={!!order} onClose={onClose} title={<CollectTitle order={order} />} size="lg" closeOnClickOutside={false}>
      {order && <CollectForm key={order.id} order={order} onClose={onClose} />}
    </Modal>
  );
}

function CollectTitle({ order }: { order: BillingDoc | null }) {
  const { t } = useTranslation();
  return (
    <Group gap="xs">
      <IconCash size={20} />
      <Text fw={600}>
        {t('ledger.collect')} <span dir="ltr">{order?.order_no}</span>
      </Text>
    </Group>
  );
}

function CollectForm({ order: initial, onClose }: { order: BillingDoc; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [order, setOrder] = useState(initial);
  // A part-paid bill: only what is left is due now.
  const dueOf = (o: BillingDoc) => (o.status === 'part_paid' && o.remaining ? o.remaining : o.patient_share);
  const [rows, setRows] = useState(() => [paymentRow('cash', dueOf(initial))]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [done, setDone] = useState<{ invoice: Invoice | null; receipt: Receipt | null; remaining: string } | null>(null);
  const account = useQuery({ queryKey: ['account', order.patient_id], queryFn: () => api<Account>(`/patients/${order.patient_id}/account`) });
  const fm = (v: string) => formatMoney(v, lang, digits);
  const paid = rowsTotal(rows);
  const due = dueOf(order);
  const remaining = subMoney(due, paid);
  const over = toCents(remaining) < 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ invoice: Invoice | null; receipt: Receipt | null; remaining: string }>(`/payment-orders/${order.id}/collect`, {
        method: 'POST',
        body: { version: order.version, expected_patient_share: order.patient_share, payments: toPayments(rows), note },
      });
      setDone(res);
      void qc.invalidateQueries({ queryKey: ['billing'] });
      void qc.invalidateQueries({ queryKey: ['account', order.patient_id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['cashbox'] });
      void qc.invalidateQueries({ queryKey: ['waiting-orders'] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'totals_changed') {
        const fresh = await api<BillingDoc>(`/payment-orders/${order.id}`);
        setOrder(fresh);
        setRows([paymentRow('cash', dueOf(fresh))]);
        setChanged(true);
        void qc.invalidateQueries({ queryKey: ['billing'] });
      } else setError(errorMessage(t, e, lang));
    } finally {
      setBusy(false);
    }
  };

  if (done && !done.invoice)
    return (
      <Stack data-testid="collect-done">
        <Alert color="orange" icon={<IconCheck />} title={t('ledger.billOwed')}>
          <Text size="sm" data-testid="bill-owed">
            {t('ledger.billOwedHint', { amount: fm(done.remaining) })}
          </Text>
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.close')}
          </Button>
        </Group>
      </Stack>
    );
  if (done && done.invoice)
    return (
      <Stack data-testid="collect-done">
        <Alert color="green" icon={<IconCheck />} title={t('ledger.invoiceIssued')}>
          <Text size="sm">
            {t('ledger.invoiceNo')}: <b dir="ltr" data-testid="issued-invoice-no">{done.invoice.invoice_no}</b>
            {done.receipt && (
              <>
                {' · '}
                {t('ledger.receiptNo')}: <b dir="ltr">{done.receipt.receipt_no}</b>
              </>
            )}
          </Text>
          {done.receipt?.balance_after && toCents(done.receipt.balance_after) > 0 && <Text size="sm">{t('ledger.balanceNow', { amount: fm(done.receipt.balance_after) })}</Text>}
          {toCents(done.remaining) > 0 && (
            <Text size="sm" data-testid="bill-remaining">
              {t('ledger.billRemaining', { amount: fm(done.remaining) })}
            </Text>
          )}
        </Alert>
        <Group>
          <Button leftSection={<IconPrinter size={16} />} onClick={() => openPrint(`/print/invoice/${done.invoice!.id}`)} data-testid="print-invoice">
            {t('ledger.printInvoice')}
          </Button>
          {done.receipt && (
            <Button variant="light" leftSection={<IconReceipt size={16} />} onClick={() => openPrint(`/print/receipt/${done.receipt!.id}`)} data-testid="print-receipt">
              {t('ledger.printReceipt')}
            </Button>
          )}
          <Button variant="default" leftSection={<IconFileInvoice size={16} />} onClick={() => navigate(`/billing/invoice/${done.invoice!.id}`)}>
            {t('ledger.openInvoice')}
          </Button>
          <Button variant="subtle" onClick={onClose} ms="auto">
            {t('common.close')}
          </Button>
        </Group>
      </Stack>
    );

  return (
    <Stack>
      <Text size="sm">
        {lang === 'ar' ? order.patient_name_ar : order.patient_name_en || order.patient_name_ar} · {t('patients.fileNo')} {order.patient_file_no}
      </Text>
      {order.reception_note && (
        <Text size="sm" c="dimmed">
          {order.reception_note}
        </Text>
      )}
      {changed && (
        <Alert color="orange" data-testid="totals-changed">
          {t('ledger.totalsChanged')}
        </Alert>
      )}
      <SimpleGrid cols={order.status === 'part_paid' ? 4 : 3}>
        <Stat label={t('billing.total')} value={fm(order.total)} />
        <Stat label={t('billing.insuranceShare')} value={fm(order.insurance_share)} />
        {order.status === 'part_paid' && <Stat label={t('ledger.paidSoFar')} value={fm(order.paid_amount ?? '0')} />}
        <Stat label={order.status === 'part_paid' ? t('ledger.leftToPay') : t('billing.patientDue')} value={fm(due)} strong testid="collect-due" />
      </SimpleGrid>
      <Divider />
      <PaymentRows rows={rows} onChange={setRows} depositAvailable={account.data?.deposit_balance} due={due} />
      <Group justify="space-between">
        <Text size="sm">
          {t('ledger.paidNow')}: <b>{fm(paid)}</b>
        </Text>
        {over ? (
          <Text size="sm" c="red">
            {t('ledger.overpaid')}
          </Text>
        ) : (
          toCents(remaining) > 0 && (
            <Text size="sm" c="orange" data-testid="to-balance">
              {toCents(paid) === 0 ? t('ledger.payLaterHint', { amount: fm(remaining) }) : t('ledger.partInvoiceHint', { paid: fm(paid), amount: fm(remaining) })}
            </Text>
          )
        )}
      </Group>
      <Textarea label={t('sample.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={1000} autosize minRows={1} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button leftSection={<IconCheck size={16} />} onClick={() => void submit()} loading={busy} disabled={over} data-testid="confirm-collect">
          {toCents(paid) === 0 && toCents(due) > 0 ? t('ledger.recordOwed') : t('ledger.issueInvoice')}
        </Button>
      </Group>
    </Stack>
  );
}

export function Stat({ label, value, strong, testid }: { label: string; value: string; strong?: boolean; testid?: string }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {strong ? (
        <Title order={4} data-testid={testid}>
          {value}
        </Title>
      ) : (
        <Text fw={500} data-testid={testid}>
          {value}
        </Text>
      )}
    </Stack>
  );
}
