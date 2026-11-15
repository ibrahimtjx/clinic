import { Alert, Button, Card, Group, NumberInput, Skeleton, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconInfoCircle } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import type { DocType, NumberFormat, Numbering } from '../master/types';

const DOCS: DocType[] = ['quotation', 'payment_order', 'invoice', 'credit_note', 'receipt'];

/** Document number formats (SPEC 10.2). Counters are read-only: numbers are never reused or skipped. */
export function NumberingTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'numbering'], queryFn: () => api<Numbering>('/settings/numbering') });
  const [form, setForm] = useState<Record<DocType, NumberFormat> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const fromServer = (n: Numbering) => Object.fromEntries(DOCS.map((d) => [d, n[d].format])) as Record<DocType, NumberFormat>;
  useEffect(() => {
    if (q.data) setForm(fromServer(q.data));
  }, [q.data]);
  const dirty = !!form && !!q.data && JSON.stringify(form) !== JSON.stringify(fromServer(q.data));

  async function save(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(['settings', 'numbering'], await api<Numbering>('/settings/numbering', { method: 'PUT', body: form }));
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
  if (!form || !q.data) return <Skeleton height={300} radius="md" />;
  const set = (d: DocType, patch: Partial<NumberFormat>) => setForm({ ...form, [d]: { ...form[d], ...patch } });
  const preview = (f: NumberFormat, issued: number) => {
    const n = String(issued + 1).padStart(f.padding, '0');
    const year = q.data.invoice.next_number.match(/-(\d{4})-/)?.[1] ?? new Date().getFullYear();
    return f.yearly_reset ? `${f.prefix}-${year}-${n}` : `${f.prefix}-${n}`;
  };

  return (
    <Card>
      {guard}
      <Stack>
        <Text fw={600}>{t('settings.tabs.numbering')}</Text>
        <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
          {t('numbering.hint')}
        </Alert>
        {error !== null && (
          <Alert color="red" variant="light">
            {errorMessage(t, error, lang)}
          </Alert>
        )}
        <Table.ScrollContainer minWidth={720}>
          <Table data-testid="numbering-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('numbering.document')}</Table.Th>
                <Table.Th>{t('numbering.prefix')}</Table.Th>
                <Table.Th>{t('numbering.yearly')}</Table.Th>
                <Table.Th>{t('numbering.digits')}</Table.Th>
                <Table.Th>{t('numbering.issued')}</Table.Th>
                <Table.Th>{t('numbering.next')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {DOCS.map((d) => (
                <Table.Tr key={d}>
                  <Table.Td fw={500}>{t(`numbering.docs.${d}`)}</Table.Td>
                  <Table.Td>
                    <TextInput value={form[d].prefix} onChange={(e) => set(d, { prefix: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} maxLength={10} w={100} dir="ltr" size="xs" />
                  </Table.Td>
                  <Table.Td>
                    <Switch checked={form[d].yearly_reset} onChange={(e) => set(d, { yearly_reset: e.currentTarget.checked })} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput value={form[d].padding} onChange={(v) => set(d, { padding: Number(v) || 6 })} min={3} max={10} w={80} size="xs" allowDecimal={false} />
                  </Table.Td>
                  <Table.Td>{q.data[d].issued}</Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={600} dir="ltr" ta="start">
                      {preview(form[d], q.data[d].issued)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Group justify="flex-end">
          <Button onClick={() => void save()} loading={busy} disabled={!dirty || DOCS.some((d) => !form[d].prefix)}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
