import { SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';

import { usePrefs } from '../app/preferences';
import { formatDate, formatDateTime, formatMoney, formatTime, toArabicDigits } from '../lib/format';
import type { ColType, ReportResult, ReportSection } from './types';

export function useCell() {
  const { lang, digits } = usePrefs();
  return (value: string | number | null | undefined, type: ColType): string => {
    if (value === null || value === undefined || value === '') return '';
    const d = (s: string) => (digits === 'arab' ? toArabicDigits(s) : s);
    switch (type) {
      case 'money':
        return formatMoney(String(value), lang, digits);
      case 'date':
        return formatDate(String(value), lang, digits);
      case 'datetime':
        return formatDateTime(String(value), lang, digits);
      case 'time':
        return formatTime(String(value), lang, digits);
      case 'pct':
        return d(`${value}%`);
      case 'int':
      case 'number':
        return d(String(value));
      default:
        return String(value);
    }
  };
}

const numeric = (t: ColType) => t === 'money' || t === 'int' || t === 'number' || t === 'pct';

/** Text in the user's language: a column `x_ar` (or `x`) has an English twin `x_en` in the row. */
export function textOf(row: Record<string, string | number | null>, key: string, lang: string) {
  if (lang === 'en') {
    const twin = key.endsWith('_ar') ? `${key.slice(0, -3)}_en` : `${key}_en`;
    if (row[twin]) return row[twin];
  }
  return row[key];
}

export function SectionTable({ section, compact, className }: { section: ReportSection; compact?: boolean; className?: string }) {
  const { lang } = usePrefs();
  const cell = useCell();
  return (
    <Table striped={!compact} withTableBorder className={className} data-testid={`section-${section.key}`} fz={compact ? 11 : 'sm'}>
      <Table.Thead>
        <Table.Tr>
          {section.columns.map((c) => (
            <Table.Th key={c.key} ta={numeric(c.type) ? 'end' : undefined}>
              {lang === 'ar' ? c.ar : c.en}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {section.rows.length === 0 && (
          <Table.Tr>
            <Table.Td colSpan={section.columns.length}>
              <Text size="sm" c="dimmed" ta="center">
                —
              </Text>
            </Table.Td>
          </Table.Tr>
        )}
        {section.rows.map((r, i) => (
          <Table.Tr key={i}>
            {section.columns.map((c) => (
              <Table.Td key={c.key} ta={numeric(c.type) ? 'end' : undefined} style={numeric(c.type) ? { whiteSpace: 'nowrap' } : undefined}>
                {cell(c.type === 'text' ? textOf(r, c.key, lang) : r[c.key], c.type)}
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
      {section.totals && section.rows.length > 0 && (
        <Table.Tfoot>
          <Table.Tr fw={700}>
            {section.columns.map((c, i) => (
              <Table.Td key={c.key} ta={numeric(c.type) ? 'end' : undefined} style={{ whiteSpace: 'nowrap' }}>
                {i === 0 && !(c.key in section.totals!) ? (lang === 'ar' ? 'الإجمالي' : 'Total') : cell(section.totals![c.key], c.type)}
              </Table.Td>
            ))}
          </Table.Tr>
        </Table.Tfoot>
      )}
    </Table>
  );
}

export function ReportBody({ report, compact, tableClass }: { report: ReportResult; compact?: boolean; tableClass?: string }) {
  const { lang } = usePrefs();
  const cell = useCell();
  return (
    <Stack gap={compact ? 'sm' : 'lg'} data-testid="report-body">
      {report.sections.map((s) => (
        <Stack key={s.key} gap={4}>
          {(report.sections.length > 1 || s.key.startsWith('doctor-')) && <Title order={compact ? 5 : 4}>{lang === 'ar' ? s.title_ar : s.title_en}</Title>}
          {compact ? (
            <SectionTable section={s} compact className={tableClass} />
          ) : (
            <Table.ScrollContainer minWidth={Math.max(600, s.columns.length * 110)}>
              <SectionTable section={s} />
            </Table.ScrollContainer>
          )}
        </Stack>
      ))}
      {report.summary.length > 0 && (
        <Stack gap={4}>
          <Title order={compact ? 5 : 4}>{lang === 'ar' ? 'الملخص' : 'Summary'}</Title>
          <SimpleGrid cols={compact ? 3 : { base: 2, md: 4 }} spacing="xs" data-testid="report-summary">
            {report.summary.map((i) => (
              <Stack key={i.en} gap={0} p={compact ? 2 : 'xs'} style={{ border: '1px solid var(--app-border)', borderRadius: 6 }}>
                <Text size="xs" c="dimmed">
                  {lang === 'ar' ? i.ar : i.en}
                </Text>
                <Text fw={600} size={compact ? 'sm' : 'md'}>
                  {cell(i.value, i.type)}
                </Text>
              </Stack>
            ))}
          </SimpleGrid>
        </Stack>
      )}
      {(lang === 'ar' ? report.notes_ar : report.notes_en).map((n) => (
        <Text key={n} size="xs" c="dimmed">
          {n}
        </Text>
      ))}
    </Stack>
  );
}
