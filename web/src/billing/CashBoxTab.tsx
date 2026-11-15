import { Alert, Anchor, Button, Card, Group, Modal, Skeleton, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { IconLock, IconPrinter } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatMoney } from '../lib/format';
import { openPrint } from './CollectModal';
import type { BoxTotals, Closing } from './ledgerTypes';

interface BoxOut {
  user_id: number;
  user_name: string | null;
  totals: BoxTotals;
  last_closing: Closing | null;
}

/** Cash box closing per user per shift (SPEC 10.9). */
export function CashBoxTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const [closing, setClosing] = useState<{ userId?: number; name?: string | null } | null>(null);
  const mine = useQuery({ queryKey: ['cashbox', 'current'], queryFn: () => api<BoxOut>('/cash-box/current'), enabled: can('payment.collect') || can('cashbox.close') });
  const open = useQuery({ queryKey: ['cashbox', 'open'], queryFn: () => api<{ user_id: number; user_name: string | null; since: string | null; count: number; net_total: string }[]>('/cash-box/open'), enabled: can('cashbox.close') });
  const closings = useQuery({ queryKey: ['cashbox', 'closings'], queryFn: () => api<Closing[]>('/cash-box/closings', { query: { limit: 30 } }) });
  const { digits } = usePrefs();
  const fm = (v: string) => formatMoney(v, lang, digits);
  return (
    <Stack data-testid="cash-box">
      <Card>
        <Group justify="space-between" mb="sm">
          <Stack gap={0}>
            <Title order={3}>{t('ledger.myBox')}</Title>
            {mine.data && (
              <Text size="sm" c="dimmed">
                {mine.data.totals.from_at ? t('ledger.since', { at: formatDateTime(mine.data.totals.from_at, lang, digits) }) : t('ledger.sinceStart')} · {t('ledger.movements', { n: mine.data.totals.count })}
              </Text>
            )}
          </Stack>
          <Button leftSection={<IconLock size={16} />} onClick={() => setClosing({})} disabled={!mine.data} data-testid="close-box">
            {t('ledger.closeShift')}
          </Button>
        </Group>
        {mine.isPending ? <Skeleton height={160} /> : mine.isError ? <Alert color="red">{errorMessage(t, mine.error, lang)}</Alert> : <BoxTable totals={mine.data.totals} />}
      </Card>
      {can('cashbox.close') && open.data && open.data.length > 0 && (
        <Card>
          <Title order={4} mb="xs">
            {t('ledger.openBoxes')}
          </Title>
          <Table data-testid="open-boxes">
            <Table.Tbody>
              {open.data.map((o) => (
                <Table.Tr key={o.user_id}>
                  <Table.Td>{o.user_name}</Table.Td>
                  <Table.Td fz="sm">{o.since ? formatDateTime(o.since, lang, digits) : '—'}</Table.Td>
                  <Table.Td fz="sm">{t('ledger.movements', { n: o.count })}</Table.Td>
                  <Table.Td ta="end" fw={600}>
                    {fm(o.net_total)}
                  </Table.Td>
                  <Table.Td ta="end">
                    <Button size="xs" variant="light" onClick={() => setClosing({ userId: o.user_id, name: o.user_name })}>
                      {t('ledger.closeShift')}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
      <Card padding={0}>
        <Text fw={600} p="sm">
          {t('ledger.closings')}
        </Text>
        <Table data-testid="closings">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('ledger.user')}</Table.Th>
              <Table.Th>{t('ledger.shift')}</Table.Th>
              <Table.Th ta="end">{t('ledger.netTotal')}</Table.Th>
              <Table.Th>{t('sample.note')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(closings.data ?? []).map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>{c.user_name}</Table.Td>
                <Table.Td fz="sm">
                  {c.from_at ? formatDateTime(c.from_at, lang, digits) : '—'} → {formatDateTime(c.to_at, lang, digits)}
                </Table.Td>
                <Table.Td ta="end">{fm(c.totals_json.net.total)}</Table.Td>
                <Table.Td fz="sm">{c.note}</Table.Td>
                <Table.Td ta="end">
                  <Anchor size="sm" onClick={() => openPrint(`/print/closing/${c.id}`)}>
                    <IconPrinter size={14} /> {t('print.print')}
                  </Anchor>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
      <CloseModal target={closing} onClose={() => setClosing(null)} />
    </Stack>
  );
}

export function BoxTable({ totals }: { totals: BoxTotals }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const fm = (v: string) => formatMoney(v, lang, digits);
  // Only methods that moved money this shift.
  const used = totals.methods.filter((m) => m.in.total !== '0.00' || m.out.total !== '0.00');
  const cells = (s: { net: string; vat: string; total: string }, strong?: boolean) => (
    <>
      <Table.Td ta="end">{fm(s.net)}</Table.Td>
      <Table.Td ta="end">{fm(s.vat)}</Table.Td>
      <Table.Td ta="end" fw={strong ? 700 : 500}>
        {fm(s.total)}
      </Table.Td>
    </>
  );
  return (
    <Stack gap="xs">
      <Table.ScrollContainer minWidth={700}>
        <Table withColumnBorders data-testid="box-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('ledger.method')}</Table.Th>
              <Table.Th />
              <Table.Th ta="end">{t('ledger.withoutVat')}</Table.Th>
              <Table.Th ta="end">VAT</Table.Th>
              <Table.Th ta="end">{t('billing.total')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {used.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text size="sm" c="dimmed" ta="center">
                    {t('ledger.noMovements')}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {used.map((m) =>
              (['in', 'out', 'net'] as const).map((k, i) => (
                <Table.Tr key={`${m.method}-${k}`} data-testid={`box-${m.method}-${k}`}>
                  {i === 0 && (
                    <Table.Td rowSpan={3} fw={600}>
                      {t(`ledger.methods.${m.method}`)}
                    </Table.Td>
                  )}
                  <Table.Td fz="sm">{t(`ledger.box.${k}`)}</Table.Td>
                  {cells(m[k], k === 'net')}
                </Table.Tr>
              )),
            )}
            <Table.Tr bg="var(--mantine-color-default-hover)">
              <Table.Td fw={700}>{t('ledger.allMethods')}</Table.Td>
              <Table.Td fz="sm">{t('ledger.box.net')}</Table.Td>
              {cells(totals.net, true)}
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text size="xs" c="dimmed">
        {t('ledger.boxNote', { taken: fm(totals.deposits_taken), used: fm(totals.deposit_used), kept: fm(totals.credit_to_deposit) })}
      </Text>
    </Stack>
  );
}

function CloseModal({ target, onClose }: { target: { userId?: number; name?: string | null } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await api<Closing>('/cash-box/close', { method: 'POST', body: { user_id: target?.userId, note } });
      void qc.invalidateQueries({ queryKey: ['cashbox'] });
      setNote('');
      onClose();
      openPrint(`/print/closing/${c.id}`);
    } catch (e) {
      setError(errorMessage(t, e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={!!target} onClose={onClose} title={target?.name ? t('ledger.closeFor', { name: target.name }) : t('ledger.closeShift')}>
      <Stack>
        <Text size="sm">{t('ledger.closeHint')}</Text>
        <Textarea label={t('sample.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={1000} autosize minRows={2} placeholder={t('ledger.closeNoteHint')} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button leftSection={<IconLock size={16} />} onClick={() => void submit()} loading={busy} data-testid="confirm-close">
            {t('ledger.closeAndPrint')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
