import { Alert, Anchor, Badge, Button, Card, Combobox, Group, InputBase, Select, SimpleGrid, Skeleton, Stack, Text, Title, useCombobox } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconChartBar, IconFileSpreadsheet, IconPlayerPlay, IconPrinter, IconReportMoney } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { api, apiDownload } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { nameOf } from '../master/queries';
import { useQuickSearch } from '../patients/queries';
import { ReportBody } from './ReportTables';
import type { ReportInfo, ReportOptions, ReportResult } from './types';

export const useCatalog = () => useQuery({ queryKey: ['reports', 'catalog'], queryFn: () => api<ReportInfo[]>('/reports') });

/** Reports (SPEC 11): catalog, then one report with filters, preview, print/PDF and Excel. */
export function ReportsPage() {
  const { key } = useParams();
  return key ? <ReportView reportKey={key} /> : <Catalog />;
}

function Catalog() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const q = useCatalog();
  if (q.isPending) return <Skeleton height={300} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  return (
    <Stack data-testid="reports-catalog">
      <Title order={1}>{t('nav.reports')}</Title>
      {(['financial', 'operational'] as const).map((g) => {
        const items = q.data.filter((r) => r.group === g);
        if (!items.length) return null;
        return (
          <Stack key={g} gap="xs">
            <Text fw={600}>{t(`reports.groups.${g}`)}</Text>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {items.map((r) => (
                <Card key={r.key} component={Link} to={`/reports/${r.key}`} withBorder data-testid={`report-${r.key}`} style={{ textDecoration: 'none' }}>
                  <Group gap="xs" mb={4}>
                    {g === 'financial' ? <IconReportMoney size={18} /> : <IconChartBar size={18} />}
                    <Text fw={600}>{lang === 'ar' ? r.title_ar : r.title_en}</Text>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {lang === 'ar' ? r.description_ar : r.description_en}
                  </Text>
                </Card>
              ))}
            </SimpleGrid>
          </Stack>
        );
      })}
    </Stack>
  );
}

const FILTER_KEYS = ['date_from', 'date_to', 'user_id', 'doctor_id', 'patient_id', 'clinic_id', 'method', 'company_id'] as const;
type FilterState = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

export const paramsToQuery = (sp: URLSearchParams): FilterState => Object.fromEntries(FILTER_KEYS.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!]));

function defaults(info: ReportInfo): FilterState {
  if (info.filters.includes('day')) return { date_from: dayjs().format('YYYY-MM-DD') };
  if (info.filters.includes('date_range')) return { date_from: dayjs().startOf('month').format('YYYY-MM-DD'), date_to: dayjs().format('YYYY-MM-DD') };
  return {};
}

function ReportView({ reportKey }: { reportKey: string }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const [sp, setSp] = useSearchParams();
  const catalog = useCatalog();
  const info = catalog.data?.find((r) => r.key === reportKey);
  const applied = paramsToQuery(sp);
  const [draft, setDraft] = useState<FilterState>(applied);
  const [patientLabel, setPatientLabel] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>(null);

  // First open: this month (or today) and run.
  useEffect(() => {
    if (info && !sp.toString()) {
      const d = defaults(info);
      setDraft(d);
      if (!info.filters.includes('patient_required')) setSp(d as Record<string, string>, { replace: true });
    }
  }, [info, sp, setSp]);

  const ready = !!info && !!sp.toString() && (!info.filters.includes('patient_required') || !!applied.patient_id);
  const result = useQuery({
    queryKey: ['reports', 'run', reportKey, sp.toString()],
    queryFn: () => api<ReportResult>(`/reports/${reportKey}`, { query: applied }),
    enabled: ready,
  });
  if (catalog.isPending) return <Skeleton height={300} />;
  if (!info) return <Alert color="red">{t('errors.forbidden')}</Alert>;

  const apply = () => setSp(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)) as Record<string, string>);
  const excel = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await apiDownload(`/reports/${reportKey}/excel`, { ...applied, lang }, `${reportKey}.xlsx`);
    } catch (e) {
      setDownloadError(e);
    } finally {
      setDownloading(false);
    }
  };
  const title = lang === 'ar' ? info.title_ar : info.title_en;
  return (
    <Stack data-testid="report-view">
      <Group justify="space-between">
        <Stack gap={0}>
          <Anchor component={Link} to="/reports" size="sm">
            {t('nav.reports')}
          </Anchor>
          <Title order={1}>{title}</Title>
        </Stack>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconPrinter size={16} />} disabled={!result.data} onClick={() => window.open(`/print/report/${reportKey}?${sp.toString()}`, '_blank', 'noopener')} data-testid="report-print">
            {t('reports.printPdf')}
          </Button>
          <Button variant="light" leftSection={<IconFileSpreadsheet size={16} />} disabled={!result.data} loading={downloading} onClick={() => void excel()} data-testid="report-excel">
            Excel
          </Button>
        </Group>
      </Group>
      <FilterPanel info={info} value={draft} onChange={setDraft} patientLabel={patientLabel} setPatientLabel={setPatientLabel} onApply={apply} />
      {downloadError !== null && <Alert color="red">{errorMessage(t, downloadError, lang)}</Alert>}
      {info.filters.includes('patient_required') && !applied.patient_id && <Alert color="blue">{t('reports.choosePatient')}</Alert>}
      {result.isFetching && !result.data && <Skeleton height={240} />}
      {result.isError && <Alert color="red">{errorMessage(t, result.error, lang)}</Alert>}
      {result.data && (
        <Card>
          <Group gap="xs" mb="sm">
            {result.data.period && <Badge variant="light">{result.data.period}</Badge>}
            {result.data.patient && (
              <Badge variant="light" color="grape">
                {result.data.patient.name_ar} · {result.data.patient.file_no}
              </Badge>
            )}
          </Group>
          <ReportBody report={result.data} />
        </Card>
      )}
    </Stack>
  );
}

const METHODS = ['cash', 'mada', 'credit_card', 'bank_transfer', 'deposit'];

function FilterPanel({ info, value, onChange, patientLabel, setPatientLabel, onApply }: { info: ReportInfo; value: FilterState; onChange: (v: FilterState) => void; patientLabel: string; setPatientLabel: (s: string) => void; onApply: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const opts = useQuery({ queryKey: ['reports', 'options'], queryFn: () => api<ReportOptions>('/reports/options') });
  const has = (k: string) => info.filters.includes(k as never);
  const set = (patch: FilterState) => onChange({ ...value, ...patch });
  const pick = (list: { id: number; name_ar: string; name_en: string }[] | undefined) => (list ?? []).map((x) => ({ value: String(x.id), label: nameOf(x, lang) }));
  const d = (s?: string) => (s ? dayjs(s).toDate() : null);
  return (
    <Card data-testid="report-filters">
      <Group align="flex-end" gap="sm">
        {has('date_range') && (
          <DatePickerInput
            type="range"
            label={t('reports.period')}
            valueFormat="DD/MM/YYYY"
            value={[d(value.date_from), d(value.date_to)]}
            onChange={([a, b]) => set({ date_from: a ? dayjs(a).format('YYYY-MM-DD') : undefined, date_to: b ? dayjs(b).format('YYYY-MM-DD') : undefined })}
            w={240}
            data-testid="filter-dates"
          />
        )}
        {has('day') && <DatePickerInput label={t('reports.day')} valueFormat="DD/MM/YYYY" value={d(value.date_from)} onChange={(a) => set({ date_from: a ? dayjs(a).format('YYYY-MM-DD') : undefined, date_to: undefined })} w={160} />}
        {(has('patient') || has('patient_required')) && <PatientFilter value={value.patient_id} label={patientLabel} onChange={(id, label) => { set({ patient_id: id ?? undefined }); setPatientLabel(label); }} required={has('patient_required')} />}
        {has('doctor') && <Select label={t('appointments.doctor')} data={pick(opts.data?.doctors)} value={value.doctor_id ?? null} onChange={(v) => set({ doctor_id: v ?? undefined })} clearable searchable w={190} placeholder={t('reports.all')} />}
        {has('clinic') && <Select label={t('reports.clinic')} data={pick(opts.data?.clinics)} value={value.clinic_id ?? null} onChange={(v) => set({ clinic_id: v ?? undefined })} clearable w={170} placeholder={t('reports.all')} />}
        {has('user') && <Select label={t('ledger.receivedBy')} data={pick(opts.data?.users)} value={value.user_id ?? null} onChange={(v) => set({ user_id: v ?? undefined })} clearable w={170} placeholder={t('reports.all')} />}
        {has('method') && <Select label={t('ledger.method')} data={METHODS.map((m) => ({ value: m, label: t(`ledger.methods.${m}`) }))} value={value.method ?? null} onChange={(v) => set({ method: v ?? undefined })} clearable w={170} placeholder={t('reports.all')} />}
        {has('company') && <Select label={t('patients.insurance')} data={pick(opts.data?.companies)} value={value.company_id ?? null} onChange={(v) => set({ company_id: v ?? undefined })} clearable w={180} placeholder={t('reports.all')} />}
        <Button leftSection={<IconPlayerPlay size={16} />} onClick={onApply} disabled={has('patient_required') && !value.patient_id} data-testid="report-run">
          {t('reports.show')}
        </Button>
      </Group>
    </Card>
  );
}

function PatientFilter({ value, label, onChange, required }: { value?: string; label: string; onChange: (id: string | null, label: string) => void; required: boolean }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const combobox = useCombobox();
  const [search, setSearch] = useState(label);
  const [debounced] = useDebouncedValue(search, 200);
  const results = useQuickSearch(value ? '' : debounced, !value);
  useEffect(() => setSearch(label), [label]);
  return (
    <Combobox store={combobox} onOptionSubmit={(id) => {
      const p = results.data?.find((x) => String(x.id) === id);
      onChange(id, p ? `${nameOf(p, lang)} · ${p.file_no}` : '');
      combobox.closeDropdown();
    }}>
      <Combobox.Target>
        <InputBase
          label={t('appointments.patient')}
          required={required}
          w={240}
          value={search}
          placeholder={t('reports.searchPatient')}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            if (value) onChange(null, '');
            combobox.openDropdown();
          }}
          onFocus={() => combobox.openDropdown()}
          rightSection={value ? <Combobox.ClearButton onClear={() => onChange(null, '')} /> : undefined}
          data-testid="filter-patient"
        />
      </Combobox.Target>
      <Combobox.Dropdown hidden={!results.data?.length}>
        <Combobox.Options>
          {(results.data ?? []).map((p) => (
            <Combobox.Option key={p.id} value={String(p.id)}>
              {nameOf(p, lang)} · {p.file_no}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
