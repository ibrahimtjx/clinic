import { Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { ReportBody } from '../reports/ReportTables';
import { paramsToQuery } from '../reports/ReportsPage';
import type { ReportResult } from '../reports/types';
import classes from './Print.module.css';
import { PrintLayout } from './PrintLayout';

/** A report on A4 landscape with the letterhead; "Save as PDF" in the print dialog gives the PDF. */
export function ReportPrint() {
  const { lang, digits } = usePrefs();
  const { key } = useParams();
  const [sp] = useSearchParams();
  const q = useQuery({ queryKey: ['reports', 'print', key, sp.toString()], queryFn: () => api<ReportResult>(`/reports/${key}`, { query: paramsToQuery(sp) }) });
  const r = q.data;
  return (
    <PrintLayout title={r ? `${r.title_ar} / ${r.title_en}` : ''} ready={!!r} size="a4-landscape">
      <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>
      {r && (
        <div data-testid="report-print">
          <Text size="sm" mb="xs">
            {r.period && `${lang === 'ar' ? 'الفترة' : 'Period'}: ${r.period} · `}
            {r.patient && `${r.patient.name_ar} (${r.patient.file_no}) · `}
            {formatDateTime(r.generated_at, lang, digits)}
          </Text>
          <ReportBody report={r} compact tableClass={classes.table} />
        </div>
      )}
    </PrintLayout>
  );
}
