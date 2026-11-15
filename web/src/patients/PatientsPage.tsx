import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Pagination,
  Popover,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue, useHotkeys, useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronUp,
  IconColumns,
  IconFileSpreadsheet,
  IconPlus,
  IconSearch,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { SearchHighlight } from '../components/SearchHighlight';
import { apiDownload } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import { nameOf, useDoctors } from '../master/queries';
import { NewPatientDrawer } from './NewPatientDrawer';
import { useInsuranceCompanies, usePatientList } from './queries';
import type { PatientFilters, PatientListItem } from './types';

type ColKey = 'file_no' | 'name' | 'mobile' | 'national_id' | 'doctor' | 'insurance' | 'balance' | 'last_visit_at';
const ALL_COLS: ColKey[] = ['file_no', 'name', 'mobile', 'national_id', 'doctor', 'insurance', 'balance', 'last_visit_at'];
const SORTABLE: Partial<Record<ColKey, string>> = { file_no: 'file_no', name: 'name', last_visit_at: 'last_visit_at' };
const PAGE_SIZE = 50;

/** Patient list (SPEC 5.1). */
export function PatientsPage() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { me, can } = useAuth();
  const navigate = useNavigate();
  const doctors = useDoctors({ includeInactive: true });
  const companies = useInsuranceCompanies(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 200);
  const [filters, setFilters] = useState<PatientFilters>({});
  const [page, setPage] = useState(1);
  const [params, setParams] = useSearchParams();
  const [creating, setCreatingState] = useState(params.get('new') === '1');
  const setCreating = (v: boolean) => {
    setCreatingState(v);
    if (!v && params.has('new')) setParams({}, { replace: true });
  };
  // Column choice and order are saved per user on this PC.
  const [cols, setCols] = useLocalStorage<ColKey[]>({ key: `clinic.patientCols.${me?.id ?? 0}`, defaultValue: ALL_COLS });
  const visibleCols = cols.filter((c) => ALL_COLS.includes(c));

  useEffect(() => {
    if (params.get('new') === '1') setCreatingState(true);
  }, [params]);

  const query: PatientFilters = { ...filters, q: debounced };
  const list = usePatientList(query, page, PAGE_SIZE);
  useHotkeys([
    ['/', () => searchRef.current?.focus()],
    ['alt+N', () => can('patient.create') && setCreating(true)],
  ]);

  const doctorName = (id: number | null) => nameOf(doctors.data?.find((d) => d.id === id), lang);
  const companyName = (id: number | null) => nameOf(companies.data?.find((c) => c.id === id), lang);
  const setFilter = (f: Partial<PatientFilters>) => {
    setFilters((x) => ({ ...x, ...f }));
    setPage(1);
  };
  const sortBy = (key: string) => setFilter({ sort: filters.sort === key ? `-${key}` : filters.sort === `-${key}` ? null : key });

  const cells: Record<ColKey, { label: string; render: (p: PatientListItem) => ReactNode; end?: boolean }> = {
    file_no: { label: t('patients.fileNo'), render: (p) => <SearchHighlight text={String(p.file_no)} query={debounced} /> },
    name: {
      label: t('patients.name'),
      render: (p) => (
        <>
          <Text size="sm" fw={500}>
            <SearchHighlight text={p.name_ar} query={debounced} />
            {!p.is_active && (
              <Badge size="xs" color="neutral" ms={6}>
                {t('users.inactive')}
              </Badge>
            )}
          </Text>
          {p.name_en && (
            <Text size="xs" c="dimmed" dir="ltr" ta="start">
              <SearchHighlight text={p.name_en} query={debounced} />
            </Text>
          )}
        </>
      ),
    },
    mobile: { label: t('patients.fields.mobile'), render: (p) => <span dir="ltr"><SearchHighlight text={p.mobile} query={debounced} /></span> },
    national_id: { label: t('patients.fields.national_id'), render: (p) => <span dir="ltr"><SearchHighlight text={p.national_id} query={debounced} /></span> },
    doctor: { label: t('patients.doctor'), render: (p) => doctorName(p.default_doctor_id) || '—' },
    insurance: { label: t('patients.insurance'), render: (p) => (p.insurance_company_id ? <Badge color="teal">{companyName(p.insurance_company_id)}</Badge> : '—') },
    balance: {
      label: t('sample.balance'),
      end: true,
      render: (p) =>
        p.balance !== '0.00' ? (
          <Text size="sm" c="red" fw={600}>
            {formatMoney(p.balance, lang, digits)}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            {formatMoney(p.balance, lang, digits)}
          </Text>
        ),
    },
    last_visit_at: { label: t('patients.lastVisit'), render: (p) => (p.last_visit_at ? formatDate(p.last_visit_at, lang, digits) : '—') },
  };

  async function exportXlsx() {
    try {
      await apiDownload('/patients/export/xlsx', { ...(filters as Record<string, string | number | boolean | null | undefined>), q: debounced || undefined }, 'patients.xlsx');
    } catch (e) {
      notifications.show({ color: 'red', icon: <IconX size={18} />, message: errorMessage(t, e, lang) });
    }
  }

  const total = list.data?.total ?? 0;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>{t('nav.patients')}</Title>
        <Group gap="xs">
          {can('patient.export') && (
            <Button variant="default" leftSection={<IconFileSpreadsheet size={16} />} onClick={() => void exportXlsx()} data-testid="export-xlsx">
              {t('patients.export')}
            </Button>
          )}
          {can('patient.create') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)} data-testid="new-patient">
              {t('patients.new')}
            </Button>
          )}
        </Group>
      </Group>

      <Card padding="md">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            ref={searchRef}
            leftSection={<IconSearch size={16} />}
            placeholder={t('patients.searchHint')}
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              setPage(1);
            }}
            rightSection={
              search ? (
                <ActionIcon variant="subtle" color="neutral" size="sm" onClick={() => setSearch('')} aria-label={t('common.clear')}>
                  <IconX size={14} />
                </ActionIcon>
              ) : null
            }
            flex={1}
            miw={260}
            autoFocus
            data-testid="patient-search"
          />
          <Select
            placeholder={t('patients.doctor')}
            data={(doctors.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
            value={filters.doctor_id ? String(filters.doctor_id) : null}
            onChange={(v) => setFilter({ doctor_id: v ? Number(v) : null })}
            clearable
            w={180}
          />
          <Select
            placeholder={t('patients.insurance')}
            data={(companies.data ?? []).map((c) => ({ value: String(c.id), label: nameOf(c, lang) }))}
            value={filters.insurance_company_id ? String(filters.insurance_company_id) : null}
            onChange={(v) => setFilter({ insurance_company_id: v ? Number(v) : null })}
            clearable
            w={180}
          />
          <DatePickerInput
            type="range"
            placeholder={t('patients.createdRange')}
            valueFormat="DD/MM/YYYY"
            value={[filters.created_from ? dayjs(filters.created_from).toDate() : null, filters.created_to ? dayjs(filters.created_to).toDate() : null]}
            onChange={([a, b]) => setFilter({ created_from: a ? dayjs(a).format('YYYY-MM-DD') : null, created_to: b ? dayjs(b).format('YYYY-MM-DD') : null })}
            clearable
            w={230}
          />
          <Switch label={t('patients.hasBalance')} checked={!!filters.has_balance} onChange={(e) => setFilter({ has_balance: e.currentTarget.checked || null })} />
          <Switch label={t('master.showInactive')} checked={!!filters.include_inactive} onChange={(e) => setFilter({ include_inactive: e.currentTarget.checked })} />
          <ColumnChooser cols={visibleCols} onChange={setCols} labels={Object.fromEntries(ALL_COLS.map((c) => [c, cells[c].label])) as Record<ColKey, string>} />
        </Group>
      </Card>

      <Card padding={0}>
        {list.isPending ? (
          <Stack p="md" gap="sm">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} height={30} />
            ))}
          </Stack>
        ) : list.isError ? (
          <Alert m="md" color="red" variant="light">
            {errorMessage(t, list.error, lang)}
          </Alert>
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={IconUsers}
            title={debounced ? t('patients.noMatch') : t('patients.emptyTitle')}
            hint={debounced ? t('patients.noMatchHint') : t('patients.emptyHint')}
            action={
              can('patient.create') ? (
                <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setCreating(true)}>
                  {t('patients.new')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table.ScrollContainer minWidth={900}>
              <Table data-testid="patients-table" style={{ opacity: list.isPlaceholderData ? 0.6 : 1 }}>
                <Table.Thead>
                  <Table.Tr>
                    {visibleCols.map((c) => (
                      <Table.Th key={c} ta={cells[c].end ? 'end' : undefined}>
                        {SORTABLE[c] ? (
                          <UnstyledButton onClick={() => sortBy(SORTABLE[c]!)} fw={600} fz="sm">
                            <Group gap={4} wrap="nowrap">
                              {cells[c].label}
                              {filters.sort === SORTABLE[c] && <IconArrowUp size={14} />}
                              {filters.sort === `-${SORTABLE[c]}` && <IconArrowDown size={14} />}
                            </Group>
                          </UnstyledButton>
                        ) : (
                          cells[c].label
                        )}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {list.data.items.map((p) => (
                    <Table.Tr
                      key={p.id}
                      onClick={() => navigate(`/patients/${p.id}`)}
                      style={{ cursor: 'pointer' }}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/patients/${p.id}`)}
                      data-testid={`patient-row-${p.file_no}`}
                    >
                      {visibleCols.map((c) => (
                        <Table.Td key={c} ta={cells[c].end ? 'end' : undefined}>
                          {cells[c].render(p)}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group justify="space-between" p="md">
              <Text size="sm" c="dimmed" data-testid="patients-total">
                {t('patients.total', { count: total })}
              </Text>
              {total > PAGE_SIZE && <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={setPage} size="sm" />}
            </Group>
          </>
        )}
      </Card>
      <NewPatientDrawer opened={creating} onClose={() => setCreating(false)} />
    </Stack>
  );
}

function ColumnChooser({ cols, onChange, labels }: { cols: ColKey[]; onChange: (c: ColKey[]) => void; labels: Record<ColKey, string> }) {
  const { t } = useTranslation();
  const ordered = [...cols, ...ALL_COLS.filter((c) => !cols.includes(c))];
  const move = (c: ColKey, dir: -1 | 1) => {
    const i = cols.indexOf(c);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <Popover position="bottom-end" width={260} shadow="md">
      <Popover.Target>
        <Tooltip label={t('patients.columns')}>
          <ActionIcon variant="default" size="lg" aria-label={t('patients.columns')} data-testid="column-chooser">
            <IconColumns size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6}>
          {ordered.map((c) => (
            <Group key={c} justify="space-between" wrap="nowrap">
              <Checkbox
                label={labels[c]}
                checked={cols.includes(c)}
                disabled={c === 'name'}
                onChange={(e) => onChange(e.currentTarget.checked ? [...cols, c] : cols.filter((x) => x !== c))}
              />
              {cols.includes(c) && (
                <Group gap={0} wrap="nowrap">
                  <ActionIcon size="sm" variant="subtle" color="neutral" onClick={() => move(c, -1)} aria-label={t('master.moveUp')}>
                    <IconChevronUp size={14} />
                  </ActionIcon>
                  <ActionIcon size="sm" variant="subtle" color="neutral" onClick={() => move(c, 1)} aria-label={t('master.moveDown')}>
                    <IconChevronDown size={14} />
                  </ActionIcon>
                </Group>
              )}
            </Group>
          ))}
          <Button size="xs" variant="subtle" onClick={() => onChange(ALL_COLS)}>
            {t('patients.resetColumns')}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
