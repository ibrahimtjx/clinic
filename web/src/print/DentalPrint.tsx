import { Divider, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { ToothChart } from '../dental/ToothChart';
import { TEXT_FIELDS, type DentalRecord } from '../dental/types';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { nameOf, useDepartments, useDoctors } from '../master/queries';
import { usePatient } from '../patients/queries';
import { PrintLayout } from './PrintLayout';

/** Visit history statement, or a single visit, with the tooth chart (SPEC 8.2–8.4). A4. */
export function DentalPrint() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { id } = useParams();
  const [params] = useSearchParams();
  const only = Number(params.get('visit')) || null;
  const patient = usePatient(Number(id));
  const rec = useQuery({ queryKey: ['dental', 'print', id], queryFn: () => api<DentalRecord>(`/patients/${id}/dental`), gcTime: 0 });
  const doctors = useDoctors({ includeInactive: true });
  const deps = useDepartments({ includeInactive: true });
  const visits = (rec.data?.visits ?? []).filter((v) => !only || v.id === only);
  const p = patient.data;
  return (
    <PrintLayout title={only ? t('dental.visitReport') : t('dental.historyStatement')} ready={!!rec.data && !!p && !!doctors.data}>
      {p && (
        <Text size="sm" mb="sm">
          <b>{nameOf(p, lang)}</b> · {t('patients.fileNo')} {p.file_no}
          {p.allergies ? ` · ${t('patients.fields.allergies')}: ${p.allergies}` : ''}
        </Text>
      )}
      {rec.data && (
        <ToothChart
          selected={only ? (visits[0]?.teeth ?? []) : []}
          findings={rec.data.findings}
          visits={rec.data.visits}
          dentition="permanent"
          printable
        />
      )}
      <Stack gap="sm" mt="md" data-testid="dental-print">
        {visits.map((v) => (
          <div key={v.id} style={{ breakInside: 'avoid' }}>
            <Divider my={4} />
            <Text fw={700} size="sm">
              {formatDateTime(v.visit_at, lang, digits)} · {nameOf(doctors.data?.find((d) => d.id === v.doctor_id), lang)}
              {v.department_id ? ` · ${nameOf(deps.data?.find((d) => d.id === v.department_id), lang)}` : ''}
              {v.teeth.length ? ` · ${t('dental.teeth')}: ${v.teeth.join('، ')}` : ''}
            </Text>
            {TEXT_FIELDS.filter((f) => v[f]).map((f) => (
              <Text size="sm" key={f}>
                <b>{t(`dental.fields.${f}`)}:</b> {v[f]}
              </Text>
            ))}
            {v.icd10 && (
              <Text size="sm">
                <b>ICD-10:</b> {v.icd10}
              </Text>
            )}
            {v.addenda.map((a) => (
              <Text size="sm" key={a.id} fs="italic">
                {t('dental.addendum')} ({formatDateTime(a.created_at, lang, digits)}, {a.created_by_name}): {a.text}
              </Text>
            ))}
          </div>
        ))}
      </Stack>
    </PrintLayout>
  );
}
