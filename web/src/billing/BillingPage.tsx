import { Alert, Badge, Button, Card, Group, Skeleton, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import { IconBuildingBank, IconCash, IconFileDollar, IconFileInvoice, IconInbox, IconReceipt2 } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney, formatTime } from '../lib/format';
import { nameOf, useDoctors } from '../master/queries';
import { AccountPanel, InvoiceList } from './AccountPanel';
import { CashBoxTab } from './CashBoxTab';
import { CollectModal } from './CollectModal';
import type { BillingDoc, DocKind } from './types';

export const STATUS_COLOR: Record<string, string> = { draft: 'neutral', sent: 'blue', accepted: 'green', converted: 'teal', paid: 'green', part_paid: 'yellow', closed: 'grape', expired: 'orange', cancelled: 'red' };

/** Billing (SPEC 10.5): payment orders waiting at reception, quotations, payment orders. */
export function BillingPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { tab } = useParams();
  const tabs = [
    can('payment.collect') || can('quotation.view') ? 'inbox' : null,
    can('quotation.view') ? 'quotations' : null,
    can('quotation.view') || can('payment.collect') ? 'orders' : null,
    can('invoice.view') ? 'invoices' : null,
    can('payment.collect') || can('cashbox.close') ? 'cash-box' : null,
  ].filter(Boolean) as string[];
  const current = tab && tabs.includes(tab) ? tab : tabs[0];
  return (
    <Stack>
      <Title order={1}>{t('nav.billing')}</Title>
      <Tabs value={current} onChange={(v) => v && navigate(`/billing/${v}`, { replace: true })} keepMounted={false}>
        <Tabs.List>
          {tabs.includes('inbox') && (
            <Tabs.Tab value="inbox" leftSection={<IconInbox size={16} />}>
              {t('billing.inbox')}
            </Tabs.Tab>
          )}
          {tabs.includes('quotations') && (
            <Tabs.Tab value="quotations" leftSection={<IconFileInvoice size={16} />}>
              {t('billing.quotations')}
            </Tabs.Tab>
          )}
          {tabs.includes('orders') && (
            <Tabs.Tab value="orders" leftSection={<IconReceipt2 size={16} />}>
              {t('billing.orders')}
            </Tabs.Tab>
          )}
          {tabs.includes('invoices') && (
            <Tabs.Tab value="invoices" leftSection={<IconFileDollar size={16} />} data-testid="tab-invoices">
              {t('ledger.invoices')}
            </Tabs.Tab>
          )}
          {tabs.includes('cash-box') && (
            <Tabs.Tab value="cash-box" leftSection={<IconBuildingBank size={16} />} data-testid="tab-cash-box">
              {t('ledger.cashBox')}
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="inbox" pt="md">
          <DocList kind="payment_order" query={{ status: 'sent' }} inbox />
        </Tabs.Panel>
        <Tabs.Panel value="quotations" pt="md">
          <DocList kind="quotation" query={{}} />
        </Tabs.Panel>
        <Tabs.Panel value="orders" pt="md">
          <DocList kind="payment_order" query={{}} />
        </Tabs.Panel>
        <Tabs.Panel value="invoices" pt="md">
          <InvoiceList />
        </Tabs.Panel>
        <Tabs.Panel value="cash-box" pt="md">
          <CashBoxTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export function DocList({ kind, query, inbox, patientId }: { kind: DocKind; query: Record<string, string>; inbox?: boolean; patientId?: number }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const navigate = useNavigate();
  const doctors = useDoctors({ includeInactive: true });
  const { can } = useAuth();
  const [collecting, setCollecting] = useState<BillingDoc | null>(null);
  const path = kind === 'quotation' ? '/quotations' : '/payment-orders';
  const q = useQuery({
    queryKey: ['billing', 'list', kind, query, patientId],
    queryFn: () => api<BillingDoc[]>(path, { query: { ...query, patient_id: patientId } }),
    refetchInterval: inbox ? 15_000 : false,
  });
  const canCollect = can('payment.collect') && (inbox || !!q.data?.some((d) => d.status === 'part_paid'));
  if (q.isPending) return <Skeleton height={200} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  if (!q.data.length)
    return (
      <Card>
        <EmptyState icon={inbox ? IconInbox : IconFileInvoice} title={inbox ? t('billing.inboxEmpty') : t('master.emptyTitle')} hint={inbox ? t('billing.inboxEmptyHint') : ''} />
      </Card>
    );
  return (
    <Card padding={0}>
      <Table.ScrollContainer minWidth={900}>
        <Table highlightOnHover data-testid={inbox ? 'inbox' : `list-${kind}`}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('billing.number')}</Table.Th>
              {!patientId && <Table.Th>{t('appointments.patient')}</Table.Th>}
              <Table.Th>{t('appointments.doctor')}</Table.Th>
              <Table.Th ta="end">{t('billing.total')}</Table.Th>
              <Table.Th ta="end">{t('billing.patientDue')}</Table.Th>
              <Table.Th>{inbox ? t('billing.waitingSince') : t('sample.date')}</Table.Th>
              <Table.Th>{inbox ? t('sample.note') : t('sample.status')}</Table.Th>
              {canCollect && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {q.data.map((d) => (
              <Table.Tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/billing/${kind === 'quotation' ? 'quotation' : 'payment-order'}/${d.id}`)}>
                <Table.Td fw={500}>
                  <span dir="ltr">{d.quotation_no ?? d.order_no}</span>
                </Table.Td>
                {!patientId && (
                  <Table.Td>
                    {nameOf({ name_ar: d.patient_name_ar, name_en: d.patient_name_en }, lang)}{' '}
                    <Text span size="xs" c="dimmed">
                      {d.patient_file_no}
                    </Text>
                  </Table.Td>
                )}
                <Table.Td>{nameOf(doctors.data?.find((x) => x.id === d.doctor_id), lang) || '—'}</Table.Td>
                <Table.Td ta="end">{formatMoney(d.total, lang, digits)}</Table.Td>
                <Table.Td ta="end" fw={600}>
                  {formatMoney(d.patient_share, lang, digits)}
                </Table.Td>
                <Table.Td fz="sm">
                  {inbox && d.sent_at ? (
                    <>
                      {formatTime(d.sent_at, lang, digits)}{' '}
                      <Text span size="xs" c="dimmed">
                        ({t('queue.minutes', { n: dayjs().diff(d.sent_at, 'minute') })})
                      </Text>
                    </>
                  ) : (
                    formatDate(d.created_at, lang, digits)
                  )}
                </Table.Td>
                <Table.Td>{inbox ? <Text size="sm">{d.reception_note || '—'}</Text> : <Badge color={STATUS_COLOR[d.status]}>{t(`billing.status.${d.status}`)}</Badge>}</Table.Td>
                {canCollect && (
                  <Table.Td ta="end">
                    {(inbox || d.status === 'part_paid') && (
                    <Button
                      size="xs"
                      leftSection={<IconCash size={14} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollecting(d);
                      }}
                      data-testid={`collect-${d.id}`}
                    >
                      {t('ledger.collect')}
                    </Button>
                    )}
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <CollectModal order={collecting} onClose={() => setCollecting(null)} />
    </Card>
  );
}

export function PatientBillingTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  return (
    <Stack data-testid="patient-billing">
      {(can('invoice.view') || can('payment.collect')) && <AccountPanel patientId={patientId} />}
      {can('quotation.edit') && (
        <Group>
          <Button leftSection={<IconFileInvoice size={16} />} onClick={() => navigate(`/billing/quotation/new?patient=${patientId}`)} data-testid="new-quotation">
            {t('patients.newQuotation')}
          </Button>
          <Button variant="light" leftSection={<IconReceipt2 size={16} />} onClick={() => navigate(`/billing/payment-order/new?patient=${patientId}`)} data-testid="new-payment-order">
            {t('billing.newPaymentOrder')}
          </Button>
        </Group>
      )}
      {can('quotation.view') && (
        <>
          <Text fw={600}>{t('billing.quotations')}</Text>
          <DocList kind="quotation" query={{}} patientId={patientId} />
        </>
      )}
      {can('invoice.view') && (
        <>
          <Text fw={600}>{t('ledger.invoices')}</Text>
          <InvoiceList patientId={patientId} />
        </>
      )}
      <Text fw={600}>{t('billing.orders')}</Text>
      <DocList kind="payment_order" query={{}} patientId={patientId} />
    </Stack>
  );
}
