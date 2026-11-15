import { ActionIcon, Alert, Badge, Button, Card, Group, MultiSelect, NumberInput, Select, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPencil, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import type { InsuranceClass } from '../billing/types';
import { AppDrawer } from '../components/AppDrawer';
import { MoneyInput } from '../components/MoneyInput';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { nameOf, useServices } from '../master/queries';
import { useInsuranceCompanies } from '../patients/queries';

/** Insurance classes and their coverage rules (SPEC 10.4; assumed Saudi rules, see SPEC Decisions). */
export function InsuranceClassesTab() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const companies = useInsuranceCompanies(true);
  const q = useQuery({ queryKey: ['master', 'insurance-classes', 'all'], queryFn: () => api<InsuranceClass[]>('/insurance-classes', { query: { include_inactive: true } }) });
  const [editing, setEditing] = useState<InsuranceClass | 'new' | null>(null);
  const fm = (v: string | null) => (v ? formatMoney(v, lang, digits) : '—');
  return (
    <Card padding={0}>
      <Group justify="space-between" p="md">
        <div>
          <Text fw={600}>{t('settings.tabs.insuranceClasses')}</Text>
          <Text size="sm" c="dimmed" maw={640}>
            {t('billing.classesHint')}
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')} disabled={!companies.data?.length} data-testid="new-class">
          {t('master.add')}
        </Button>
      </Group>
      {q.isPending ? (
        <Skeleton height={120} />
      ) : (
        <Table.ScrollContainer minWidth={860}>
          <Table data-testid="classes-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('patients.fields.ins_company_id')}</Table.Th>
                <Table.Th>{t('patients.fields.ins_class_name')}</Table.Th>
                <Table.Th>{t('billing.patientSharePct')}</Table.Th>
                <Table.Th>{t('billing.maxPerInvoice')}</Table.Th>
                <Table.Th>{t('billing.consultationLimit')}</Table.Th>
                <Table.Th>{t('billing.dailyLimit')}</Table.Th>
                <Table.Th>{t('billing.excluded')}</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(q.data ?? []).map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{nameOf(companies.data?.find((x) => x.id === c.company_id), lang)}</Table.Td>
                  <Table.Td fw={500}>
                    {c.name} {!c.is_active && <Badge size="xs" color="neutral">{t('users.inactive')}</Badge>}
                  </Table.Td>
                  <Table.Td>{c.patient_share_pct}%</Table.Td>
                  <Table.Td>{fm(c.max_patient_share_per_invoice)}</Table.Td>
                  <Table.Td>{fm(c.consultation_max_covered)}</Table.Td>
                  <Table.Td>{fm(c.daily_limit)}</Table.Td>
                  <Table.Td>{c.excluded_service_ids.length}</Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="neutral" onClick={() => setEditing(c)} aria-label={t('common.edit')}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <ClassDrawer item={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

type F = { company_id: string | null; name: string; patient_share_pct: number; max_patient_share_per_invoice: string; consultation_max_covered: string; daily_limit: string; excluded_service_ids: string[]; is_active: boolean };

function ClassDrawer({ item, onClose }: { item: InsuranceClass | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const companies = useInsuranceCompanies();
  const services = useServices({ includeInactive: true });
  const existing = item && item !== 'new' ? item : null;
  const init = (): F => ({
    company_id: existing ? String(existing.company_id) : null,
    name: existing?.name ?? '',
    patient_share_pct: Number(existing?.patient_share_pct ?? 20),
    max_patient_share_per_invoice: existing?.max_patient_share_per_invoice ?? '',
    consultation_max_covered: existing?.consultation_max_covered ?? '',
    daily_limit: existing?.daily_limit ?? '',
    excluded_service_ids: (existing?.excluded_service_ids ?? []).map(String),
    is_active: existing?.is_active ?? true,
  });
  const [f, setF] = useState<F>(init);
  const [error, setError] = useState<unknown>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setF(init()); setError(null); }, [item]);
  const opt = (v: string) => (v && v !== '0' ? v : null);
  async function save() {
    const body = {
      name: f.name,
      patient_share_pct: String(f.patient_share_pct),
      max_patient_share_per_invoice: opt(f.max_patient_share_per_invoice),
      consultation_max_covered: opt(f.consultation_max_covered),
      daily_limit: opt(f.daily_limit),
      excluded_service_ids: f.excluded_service_ids.map(Number),
      is_active: f.is_active,
    };
    try {
      if (existing) await api(`/insurance-classes/${existing.id}`, { method: 'PATCH', body: { version: existing.version, ...body } });
      else await api('/insurance-classes', { method: 'POST', body: { ...body, company_id: Number(f.company_id) } });
      await qc.invalidateQueries({ queryKey: ['master', 'insurance-classes'] });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      onClose();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <AppDrawer opened={item !== null} onClose={onClose} title={existing ? existing.name : t('master.add')}>
      <Stack data-testid="class-form">
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <Select label={t('patients.fields.ins_company_id')} data={(companies.data ?? []).map((c) => ({ value: String(c.id), label: nameOf(c, lang) }))} value={f.company_id} onChange={(v) => setF({ ...f, company_id: v })} disabled={!!existing} required />
        <TextInput label={t('patients.fields.ins_class_name')} value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} required placeholder="VIP, A, B, C" />
        <NumberInput label={t('billing.patientSharePct')} description={t('billing.patientSharePctHint')} value={f.patient_share_pct} onChange={(v) => setF({ ...f, patient_share_pct: Number(v) || 0 })} min={0} max={100} decimalScale={2} suffix="%" />
        <MoneyInput label={t('billing.maxPerInvoice')} description={t('billing.maxPerInvoiceHint')} value={f.max_patient_share_per_invoice || '0'} onChange={(v) => setF({ ...f, max_patient_share_per_invoice: v })} />
        <MoneyInput label={t('billing.consultationLimit')} description={t('billing.consultationLimitHint')} value={f.consultation_max_covered || '0'} onChange={(v) => setF({ ...f, consultation_max_covered: v })} />
        <MoneyInput label={t('billing.dailyLimit')} description={t('billing.dailyLimitHint')} value={f.daily_limit || '0'} onChange={(v) => setF({ ...f, daily_limit: v })} />
        <MultiSelect label={t('billing.excluded')} description={t('billing.excludedHint')} data={(services.data ?? []).map((s) => ({ value: String(s.id), label: `${s.code} · ${nameOf(s, lang)}` }))} value={f.excluded_service_ids} onChange={(v) => setF({ ...f, excluded_service_ids: v })} searchable clearable />
        <Text size="xs" c="dimmed">
          {t('billing.zeroMeansNone')}
        </Text>
        <Group justify="flex-end">
          <Button onClick={() => void save()} disabled={!f.company_id || !f.name.trim()}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </AppDrawer>
  );
}

export function BillingSettingsTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'billing'], queryFn: () => api<{ vat_rate: string; quotation_valid_days: number }>('/settings/billing') });
  const [f, setF] = useState<{ vat_rate: number; quotation_valid_days: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data) setF({ vat_rate: Number(q.data.vat_rate), quotation_valid_days: q.data.quotation_valid_days });
  }, [q.data]);
  if (!f) return <Skeleton height={160} />;
  return (
    <Card maw={520}>
      <Stack>
        <Text fw={600}>{t('settings.tabs.billingSettings')}</Text>
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <NumberInput label={t('billing.vatRate')} description={t('billing.vatRateHint')} value={f.vat_rate} onChange={(v) => setF({ ...f, vat_rate: Number(v) || 0 })} min={0} max={100} decimalScale={2} suffix="%" />
        <NumberInput label={t('billing.validDays')} value={f.quotation_valid_days} onChange={(v) => setF({ ...f, quotation_valid_days: Number(v) || 30 })} min={1} max={365} allowDecimal={false} />
        <Group justify="flex-end">
          <Button
            onClick={async () => {
              try {
                qc.setQueryData(['settings', 'billing'], await api('/settings/billing', { method: 'PUT', body: { vat_rate: String(f.vat_rate), quotation_valid_days: f.quotation_valid_days } }));
                notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
              } catch (e) {
                setError(e);
              }
            }}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
