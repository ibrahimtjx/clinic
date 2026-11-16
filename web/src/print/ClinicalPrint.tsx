import { Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import type { LabRequest, MedicalReport, Prescription } from '../clinical/types';
import { api } from '../lib/api';
import { ageParts, formatDate, formatDateTime } from '../lib/format';
import { usePatient } from '../patients/queries';
import classes from './Print.module.css';
import { PrintLayout } from './PrintLayout';

/** Patient block shared by the clinical prints (bilingual labels). */
function PatientBlock({ patientId, en }: { patientId: number; en?: boolean }) {
  const { digits } = usePrefs();
  const q = usePatient(patientId);
  const p = q.data;
  if (!p) return null;
  const age = p.dob ? ageParts(new Date(p.dob), new Date()) : null;
  const L = (ar: string, e: string) => (en ? e : `${ar} / ${e}`);
  return (
    <SimpleGrid cols={3} spacing={4} style={{ border: '1px solid var(--app-border)', borderRadius: 6, padding: 6 }}>
      <Text size="sm">
        {L('المريض', 'Patient')}: <b>{en ? p.name_en || p.name_ar : p.name_ar}</b>
      </Text>
      <Text size="sm">
        {L('رقم الملف', 'File no.')}: {p.file_no}
      </Text>
      <Text size="sm">
        {L('العمر', 'Age')}: {age ? age.years : '—'}
        {p.gender ? ` · ${p.gender === 'male' ? L('ذكر', 'Male') : L('أنثى', 'Female')}` : ''}
      </Text>
      {p.national_id && (
        <Text size="sm">
          {L('الهوية', 'ID')}: {p.national_id}
        </Text>
      )}
      {p.dob && (
        <Text size="sm">
          {L('تاريخ الميلاد', 'Date of birth')}: {formatDate(p.dob, en ? 'en' : 'ar', digits)}
        </Text>
      )}
      {p.allergies && (
        <Text size="sm" fw={700}>
          {L('الحساسية', 'Allergies')}: {p.allergies}
        </Text>
      )}
    </SimpleGrid>
  );
}

function Signatures({ doctor, en, children }: { doctor: string; en?: boolean; children?: ReactNode }) {
  const L = (ar: string, e: string) => (en ? e : `${ar} / ${e}`);
  return (
    <Group justify="space-between" mt={40} align="flex-end">
      <Stack gap={2}>
        <Text size="sm">
          {L('الطبيب', 'Doctor')}: {doctor}
        </Text>
        <Text size="sm">{L('التوقيع', 'Signature')}: ____________________</Text>
      </Stack>
      {children}
      <Text size="sm">{L('الختم', 'Stamp')}: ____________________</Text>
    </Group>
  );
}

function Cancelled({ reason }: { reason: string | null }) {
  return (
    <Text fw={700} c="red" size="lg">
      ملغاة / CANCELLED {reason ? `: ${reason}` : ''}
    </Text>
  );
}

export function PrescriptionPrint() {
  const { lang, digits } = usePrefs();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['print', 'rx', id], queryFn: () => api<Prescription>(`/prescriptions/${id}`) });
  const rx = q.data;
  return (
    <PrintLayout title="وصفة طبية / Prescription" ready={!!rx}>
      {rx && (
        <Stack gap="sm" data-testid="rx-print">
          <Text size="sm">
            {`Rx #${rx.id}`} · {formatDateTime(rx.issued_at, lang, digits)}
          </Text>
          {rx.status === 'cancelled' && <Cancelled reason={rx.cancel_reason} />}
          <PatientBlock patientId={rx.patient_id} />
          {rx.diagnosis && <Text size="sm">التشخيص / Diagnosis: {rx.diagnosis}</Text>}
          <Text fw={700} size="xl" dir="ltr">
            ℞
          </Text>
          <Table className={classes.table} withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>الدواء / Drug</Table.Th>
                <Table.Th>الجرعة / Dose</Table.Th>
                <Table.Th>عدد المرات / Frequency</Table.Th>
                <Table.Th>المدة / Duration</Table.Th>
                <Table.Th>الكمية / Qty</Table.Th>
                <Table.Th>تعليمات / Instructions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rx.items.map((it) => (
                <Table.Tr key={it.seq}>
                  <Table.Td>{it.seq}</Table.Td>
                  <Table.Td dir="ltr" style={{ fontWeight: 700, textAlign: 'start' }}>
                    {it.drug}
                    {it.form && <div style={{ fontWeight: 400, fontSize: 11 }}>{it.form}</div>}
                  </Table.Td>
                  <Table.Td dir="auto">{it.dose}</Table.Td>
                  <Table.Td dir="auto">{it.frequency}</Table.Td>
                  <Table.Td dir="auto">{it.duration}</Table.Td>
                  <Table.Td dir="auto">{it.quantity}</Table.Td>
                  <Table.Td dir="auto">{it.instructions}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rx.notes && <Text size="sm">{rx.notes}</Text>}
          <Signatures doctor={rx.doctor_name_ar} />
        </Stack>
      )}
    </PrintLayout>
  );
}

export function LabPrint() {
  const { lang, digits } = usePrefs();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['print', 'lab', id], queryFn: () => api<LabRequest>(`/lab-requests/${id}`) });
  const r = q.data;
  const resulted = r?.status === 'resulted';
  return (
    <PrintLayout title={resulted ? 'نتائج التحاليل / Lab results' : 'طلب تحاليل / Lab request'} ready={!!r}>
      {r && (
        <Stack gap="sm" data-testid="lab-print">
          <Text size="sm">
            #{r.id} · {formatDateTime(r.issued_at, lang, digits)}
            {r.lab_name ? ` · المختبر / Lab: ${r.lab_name}` : ''}
          </Text>
          {r.status === 'cancelled' && <Cancelled reason={r.cancel_reason} />}
          <PatientBlock patientId={r.patient_id} />
          {r.clinical_info && <Text size="sm">معلومات سريرية / Clinical information: {r.clinical_info}</Text>}
          <Table className={classes.table} withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>التحليل / Test</Table.Th>
                <Table.Th>النتيجة / Result</Table.Th>
                <Table.Th>الوحدة / Unit</Table.Th>
                <Table.Th>المعدل الطبيعي / Reference</Table.Th>
                <Table.Th>ملاحظة / Flag</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {r.items.map((it) => (
                <Table.Tr key={it.seq}>
                  <Table.Td dir="ltr" style={{ textAlign: 'start' }}>
                    {it.name}
                  </Table.Td>
                  <Table.Td dir="ltr" style={{ fontWeight: it.flag && it.flag !== 'normal' ? 700 : 400 }}>
                    {it.result || (resulted ? '—' : '')}
                  </Table.Td>
                  <Table.Td dir="ltr">{it.unit}</Table.Td>
                  <Table.Td dir="ltr">{it.reference_range}</Table.Td>
                  <Table.Td>{it.flag ? { normal: 'طبيعي / Normal', low: 'منخفض / Low', high: 'مرتفع / High', abnormal: 'غير طبيعي / Abnormal' }[it.flag] : ''}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {r.result_note && <Text size="sm">{r.result_note}</Text>}
          {r.resulted_at && (
            <Text size="xs">
              أُدخلت النتائج / Results entered: {formatDateTime(r.resulted_at, lang, digits)} · {r.resulted_by_name}
            </Text>
          )}
          <Signatures doctor={r.doctor_name_ar} />
        </Stack>
      )}
    </PrintLayout>
  );
}

const REPORT_TITLES = {
  report: ['تقرير طبي', 'Medical report'],
  referral: ['خطاب تحويل', 'Referral letter'],
  attendance: ['إشعار مراجعة', 'Attendance certificate'],
} as const;

export function MedicalReportPrint() {
  const { digits } = usePrefs();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['print', 'report', id], queryFn: () => api<MedicalReport>(`/medical-reports/${id}`) });
  const r = q.data;
  const en = r?.language === 'en';
  const title = r ? r.title || REPORT_TITLES[r.kind][en ? 1 : 0] : '';
  return (
    <PrintLayout title={title} ready={!!r}>
      {r && (
        <Stack gap="sm" dir={en ? 'ltr' : 'rtl'} data-testid="report-print">
          <Text size="sm">
            {en ? 'Date' : 'التاريخ'}: {formatDate(r.issued_at, en ? 'en' : 'ar', digits)} · #{r.id}
          </Text>
          {r.status === 'cancelled' && <Cancelled reason={r.cancel_reason} />}
          <PatientBlock patientId={r.patient_id} en={en} />
          {r.recipient && (
            <Text size="md" fw={600}>
              {r.recipient}
            </Text>
          )}
          <Text size="md" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>
            {r.body}
          </Text>
          <Signatures doctor={en ? r.doctor_name_en : r.doctor_name_ar} en={en} />
        </Stack>
      )}
    </PrintLayout>
  );
}
