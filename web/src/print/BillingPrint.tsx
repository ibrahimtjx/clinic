import { Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import type { BillingDoc } from '../billing/types';
import { api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import { nameOf, useClinicInfo, useDoctors } from '../master/queries';
import classes from './Print.module.css';
import { PrintLayout } from './PrintLayout';

/** Quotation or payment order on A4 with bilingual headers (SPEC 3.1, 10.3). */
export function BillingPrint() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { kind, id } = useParams();
  const path = kind === 'quotation' ? '/quotations' : '/payment-orders';
  const q = useQuery({ queryKey: ['billing', 'print', kind, id], queryFn: () => api<BillingDoc>(`${path}/${id}`) });
  const doctors = useDoctors({ includeInactive: true });
  const clinic = useClinicInfo();
  const d = q.data;
  const fm = (v: string) => formatMoney(v, lang, digits);
  const title = kind === 'quotation' ? 'عرض سعر / Quotation' : 'أمر دفع / Payment order';
  return (
    <PrintLayout title={`${title} ${d ? d.quotation_no ?? d.order_no : ''}`} ready={!!d && !!doctors.data}>
      {d && (
        <Stack gap="sm" data-testid="billing-print">
          <Group justify="space-between">
            <Text size="sm">
              <b>{nameOf({ name_ar: d.patient_name_ar, name_en: d.patient_name_en }, lang)}</b> · {t('patients.fileNo')} {d.patient_file_no}
            </Text>
            <Text size="sm">
              {formatDate(d.created_at, lang, digits)}
              {d.valid_until ? ` · ${t('billing.validUntil', { date: formatDate(d.valid_until, lang, digits) })}` : ''}
            </Text>
          </Group>
          <Text size="sm">
            {t('appointments.doctor')}: {nameOf(doctors.data?.find((x) => x.id === d.doctor_id), lang) || '—'}
            {d.insurance ? ` · ${t('patients.insurance')}: ${nameOf({ name_ar: d.insurance.company_name_ar ?? '', name_en: d.insurance.company_name_en ?? '' }, lang)} (${d.insurance.class_name})` : ''}
            {clinic.data?.vat_number ? ` · VAT ${clinic.data.vat_number}` : ''}
          </Text>
          <Table className={classes.table} withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>الخدمة / Service</Table.Th>
                <Table.Th>الكمية / Qty</Table.Th>
                <Table.Th>السعر / Price</Table.Th>
                <Table.Th>الخصم / Discount</Table.Th>
                <Table.Th>الضريبة / VAT</Table.Th>
                <Table.Th>الإجمالي / Total</Table.Th>
                <Table.Th>التأمين / Insurance</Table.Th>
                <Table.Th>المريض / Patient</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.lines.map((l) => (
                <Table.Tr key={l.seq}>
                  <Table.Td>
                    {l.description_ar}
                    {l.description_en && <div style={{ fontSize: 11 }}>{l.description_en}</div>}
                    {l.teeth.length > 0 && <div style={{ fontSize: 11 }}>{l.teeth.join(' ')}</div>}
                  </Table.Td>
                  <Table.Td>{l.qty}</Table.Td>
                  <Table.Td>{fm(l.price)}</Table.Td>
                  <Table.Td>{fm(l.discount)}</Table.Td>
                  <Table.Td>
                    {fm(l.vat_amount)} ({l.vat_rate}%)
                  </Table.Td>
                  <Table.Td>{fm(l.line_total)}</Table.Td>
                  <Table.Td>{fm(l.insurance_share)}</Table.Td>
                  <Table.Td>{fm(l.patient_share)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Stack gap={2} align="flex-end">
            <Text size="sm">الإجمالي قبل الخصم / Gross: {fm(d.gross)}</Text>
            <Text size="sm">الخصم / Discounts: {fm(d.discount)}</Text>
            <Text size="sm">الصافي قبل الضريبة / Net before VAT: {fm(d.net)}</Text>
            <Text size="sm">ضريبة القيمة المضافة / VAT: {fm(d.vat)}</Text>
            <Text size="sm" fw={700}>الإجمالي / Total: {fm(d.total)}</Text>
            <Text size="sm">حصة التأمين / Insurance: {fm(d.insurance_share)}</Text>
            <Text size="md" fw={700}>المستحق على المريض / Patient due: {fm(d.patient_share)}</Text>
          </Stack>
          {d.notes && <Text size="sm">{d.notes}</Text>}
          {kind === 'quotation' && <Text size="xs">{t('billing.quoteFooter')}</Text>}
        </Stack>
      )}
    </PrintLayout>
  );
}
