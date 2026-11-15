import { ActionIcon, Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { MoneyInput } from '../components/MoneyInput';
import { formatMoney } from '../lib/format';
import { fromCents, sumMoney, toCents } from '../lib/money';
import { METHODS, type Method, type PaymentRow } from './ledgerTypes';

let seq = 0;
export const paymentRow = (method: Method = 'cash', amount = '0.00'): PaymentRow => ({ key: `p${++seq}`, method, amount, reference: '' });

export const toPayments = (rows: PaymentRow[]) =>
  rows.filter((r) => r.amount && r.amount !== '0' && r.amount !== '0.00').map((r) => ({ method: r.method, amount: r.amount, reference: r.reference.trim() }));

export const rowsTotal = (rows: PaymentRow[]) => sumMoney(rows.map((r) => r.amount));

/** One or more payment methods with amounts and references (SPEC 10.5 split payments). */
export function PaymentRows({ rows, onChange, allowDeposit = true, depositAvailable, due }: { rows: PaymentRow[]; onChange: (rows: PaymentRow[]) => void; allowDeposit?: boolean; depositAvailable?: string; due?: string }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const methods = METHODS.filter((m) => allowDeposit || m !== 'deposit');
  const set = (key: string, patch: Partial<PaymentRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Stack gap="xs" data-testid="payment-rows">
      {rows.map((r, i) => (
        <Group key={r.key} gap="xs" wrap="nowrap" align="flex-end">
          <Select
            label={i === 0 ? t('ledger.method') : undefined}
            data={methods.map((m) => ({ value: m, label: t(`ledger.methods.${m}`) }))}
            value={r.method}
            onChange={(v) => v && set(r.key, { method: v as Method })}
            allowDeselect={false}
            w={170}
            data-testid={`method-${i}`}
          />
          <MoneyInput label={i === 0 ? t('ledger.amount') : undefined} value={r.amount} onChange={(v) => set(r.key, { amount: v })} w={150} data-testid={`amount-${i}`} />
          <TextInput
            label={i === 0 ? t('ledger.reference') : undefined}
            placeholder={r.method === 'cash' || r.method === 'deposit' ? '' : t('ledger.referenceHint')}
            value={r.reference}
            onChange={(e) => set(r.key, { reference: e.currentTarget.value })}
            maxLength={100}
            style={{ flex: 1 }}
            dir="ltr"
          />
          <ActionIcon variant="subtle" color="red" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} disabled={rows.length === 1} aria-label={t('common.delete')} mb={4}>
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Group justify="space-between">
        <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => onChange([...rows, paymentRow(rows.some((r) => r.method === 'cash') ? 'mada' : 'cash', due ? fromCents(Math.max(0, toCents(due) - toCents(rowsTotal(rows)))) : '0.00')])} data-testid="add-method">
          {t('ledger.addMethod')}
        </Button>
        {allowDeposit && depositAvailable && depositAvailable !== '0.00' && (
          <Text size="xs" c="dimmed">
            {t('ledger.depositAvailable', { amount: formatMoney(depositAvailable, lang, digits) })}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
