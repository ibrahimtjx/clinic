import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck, IconInfoCircle, IconPencil, IconPlus, IconSearch, IconStethoscope } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { AppDrawer } from '../components/AppDrawer';
import { EmptyState } from '../components/EmptyState';
import { cmpMoney, MoneyInput, toMoneyString } from '../components/MoneyInput';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { nameOf, useDepartments, useServices } from '../master/queries';
import type { Service } from '../master/types';

type Form = Pick<
  Service,
  'code' | 'name_ar' | 'name_en' | 'department_id' | 'sale_price' | 'min_price' | 'max_price' | 'cost_price' | 'vat_applicable' | 'is_active'
>;

const EMPTY: Form = {
  code: '',
  name_ar: '',
  name_en: '',
  department_id: null,
  sale_price: '0.00',
  min_price: '0.00',
  max_price: '0.00',
  cost_price: '0.00',
  vat_applicable: true,
  is_active: true,
};

/** Services catalog (SPEC 10.1). */
export function ServicesTab() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const services = useServices({ includeInactive: true });
  const departments = useDepartments({ includeInactive: true });
  const [q, setQ] = useState('');
  const [dep, setDep] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(false);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);

  const depName = (id: number | null) => nameOf(departments.data?.find((d) => d.id === id), lang) || '—';
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (services.data ?? []).filter(
      (s) =>
        (!onlyActive || s.is_active) &&
        (!dep || String(s.department_id) === dep) &&
        (!needle || s.code.toLowerCase().includes(needle) || s.name_ar.includes(q.trim()) || s.name_en.toLowerCase().includes(needle)),
    );
  }, [services.data, q, dep, onlyActive]);
  const unpriced = (services.data ?? []).filter((s) => !s.is_active && s.sale_price === '0.00').length;

  return (
    <Stack>
      {unpriced > 0 && (
        <Alert color="yellow" variant="light" icon={<IconInfoCircle size={18} />} data-testid="unpriced-alert">
          {t('services.unpriced', { count: unpriced })}
        </Alert>
      )}
      <Card padding={0}>
        <Group justify="space-between" p="md">
          <Text fw={600}>{t('settings.tabs.services')}</Text>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            {t('services.new')}
          </Button>
        </Group>
        <Group px="md" pb="md" gap="sm">
          <TextInput leftSection={<IconSearch size={16} />} placeholder={t('services.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} />
          <Select
            placeholder={t('services.department')}
            data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
            value={dep}
            onChange={setDep}
            clearable
            w={220}
          />
          <Switch label={t('services.onlyActive')} checked={onlyActive} onChange={(e) => setOnlyActive(e.currentTarget.checked)} />
        </Group>
        {services.isPending ? (
          <Stack p="md" gap="sm">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={28} />
            ))}
          </Stack>
        ) : services.isError ? (
          <Alert m="md" color="red" variant="light">
            {errorMessage(t, services.error, lang)}
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyState icon={IconStethoscope} title={t('master.emptyTitle')} hint={t('services.emptyHint')} />
        ) : (
          <Table.ScrollContainer minWidth={900}>
            <Table data-testid="services-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('services.code')}</Table.Th>
                  <Table.Th>{t('master.name')}</Table.Th>
                  <Table.Th>{t('services.department')}</Table.Th>
                  <Table.Th ta="end">{t('services.salePrice')}</Table.Th>
                  <Table.Th ta="end">{t('services.range')}</Table.Th>
                  <Table.Th>{t('services.vat')}</Table.Th>
                  <Table.Th>{t('users.status')}</Table.Th>
                  <Table.Th w={48} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((s) => (
                  <Table.Tr key={s.id} data-testid={`service-${s.code}`}>
                    <Table.Td>
                      <Text size="sm" fw={500} dir="ltr">
                        {s.code}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{s.name_ar}</Text>
                      <Text size="xs" c="dimmed" dir="ltr" ta="start">
                        {s.name_en}
                      </Text>
                    </Table.Td>
                    <Table.Td>{depName(s.department_id)}</Table.Td>
                    <Table.Td ta="end" fw={500}>
                      {formatMoney(s.sale_price, lang, digits)}
                    </Table.Td>
                    <Table.Td ta="end" c="dimmed" fz="sm">
                      {formatMoney(s.min_price, lang, digits)} – {formatMoney(s.max_price, lang, digits)}
                    </Table.Td>
                    <Table.Td>{s.vat_applicable ? t('common.yes') : t('common.no')}</Table.Td>
                    <Table.Td>{s.is_active ? <Badge color="green">{t('users.active')}</Badge> : <Badge color="neutral">{t('users.inactive')}</Badge>}</Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="neutral" onClick={() => setEditing(s)} aria-label={t('common.edit')}>
                        <IconPencil size={18} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
      <ServiceDrawer item={editing} onClose={() => setEditing(null)} />
    </Stack>
  );
}

function ServiceDrawer({ item, onClose }: { item: Service | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const departments = useDepartments();
  const isNew = item === 'new';
  const initial = useMemo<Form>(() => (item && item !== 'new' ? { ...EMPTY, ...pick(item) } : EMPTY), [item]);
  const [form, setForm] = useState<Form>(initial);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, confirm] = useDisclosure(false);

  useEffect(() => {
    setForm(initial);
    setVersion(item && item !== 'new' ? item.version : 0);
    setError(null);
  }, [initial, item]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const rangeBad = cmpMoney(form.min_price, form.sale_price) > 0 || cmpMoney(form.sale_price, form.max_price) > 0;

  async function save() {
    if (rangeBad) return;
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      sale_price: toMoneyString(form.sale_price),
      min_price: toMoneyString(form.min_price),
      max_price: toMoneyString(form.max_price),
      cost_price: toMoneyString(form.cost_price),
    };
    try {
      if (isNew) await api('/services', { method: 'POST', body });
      else if (item) await api(`/services/${item.id}`, { method: 'PATCH', body: { version, ...body } });
      await qc.invalidateQueries({ queryKey: ['master', 'services'] });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (!item || item === 'new') return;
    const fresh = await api<Service>(`/services/${item.id}`);
    setForm({ ...EMPTY, ...pick(fresh) });
    setVersion(fresh.version);
    setError(null);
  }

  const requestClose = () => (dirty ? confirm.open() : onClose());
  const stale = error instanceof ApiError && error.code === 'stale_record';

  return (
    <>
      <AppDrawer opened={item !== null} onClose={requestClose} title={isNew ? t('services.new') : t('services.edit')} size="lg">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
          }}
          data-testid="service-form"
        >
          <Stack>
            {error !== null && (
              <Alert color={stale ? 'yellow' : 'red'} variant="light" icon={<IconAlertCircle size={18} />}>
                <Stack gap="xs">
                  <Text size="sm">{errorMessage(t, error, lang)}</Text>
                  {stale && (
                    <Button size="xs" variant="white" w="fit-content" onClick={() => void reload()}>
                      {t('common.reload')}
                    </Button>
                  )}
                </Stack>
              </Alert>
            )}
            <SimpleGrid cols={2}>
              <TextInput label={t('services.code')} value={form.code} onChange={(e) => set('code', e.currentTarget.value.toUpperCase())} required dir="ltr" placeholder="DN021" />
              <Select
                label={t('services.department')}
                data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
                value={form.department_id == null ? null : String(form.department_id)}
                onChange={(v) => set('department_id', v ? Number(v) : null)}
                clearable
              />
            </SimpleGrid>
            <TextInput label={t('users.nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.currentTarget.value)} required />
            <TextInput label={t('users.nameEn')} value={form.name_en} onChange={(e) => set('name_en', e.currentTarget.value)} required dir="ltr" />
            <SimpleGrid cols={2}>
              <MoneyInput label={t('services.salePrice')} value={form.sale_price} onChange={(v) => set('sale_price', v)} required data-testid="sale-price" />
              <MoneyInput label={t('services.costPrice')} value={form.cost_price} onChange={(v) => set('cost_price', v)} />
              <MoneyInput label={t('services.minPrice')} value={form.min_price} onChange={(v) => set('min_price', v)} error={rangeBad ? t('errors.price_range') : undefined} />
              <MoneyInput label={t('services.maxPrice')} value={form.max_price} onChange={(v) => set('max_price', v)} error={rangeBad ? ' ' : undefined} />
            </SimpleGrid>
            <Text size="xs" c="dimmed">
              {t('services.rangeHint')}
            </Text>
            <Group>
              <Switch label={t('services.vatApplicable')} checked={form.vat_applicable} onChange={(e) => set('vat_applicable', e.currentTarget.checked)} />
              <Tooltip label={t('services.vatConfirm')} multiline w={260}>
                <IconInfoCircle size={16} color="var(--app-muted)" />
              </Tooltip>
            </Group>
            <Switch label={t('users.active')} checked={form.is_active} onChange={(e) => set('is_active', e.currentTarget.checked)} data-testid="service-active" />
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={busy} disabled={(!isNew && !dirty) || rangeBad}>
                {t('common.save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </AppDrawer>
      <UnsavedChangesModal
        opened={confirmOpen}
        onKeepEditing={confirm.close}
        onDiscard={() => {
          confirm.close();
          onClose();
        }}
        onSave={() => {
          confirm.close();
          void save();
        }}
      />
    </>
  );
}

function pick(s: Service): Form {
  return {
    code: s.code,
    name_ar: s.name_ar,
    name_en: s.name_en,
    department_id: s.department_id,
    sale_price: s.sale_price,
    min_price: s.min_price,
    max_price: s.max_price,
    cost_price: s.cost_price,
    vat_applicable: s.vat_applicable,
    is_active: s.is_active,
  };
}
