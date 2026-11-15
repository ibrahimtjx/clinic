import { Group, Image, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';

import { usePrefs } from '../app/preferences';
import { BoxTable } from '../billing/CashBoxTab';
import type { Closing, CreditNote, Invoice, Receipt } from '../billing/ledgerTypes';
import { api } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { toCents } from '../lib/money';
import classes from './Print.module.css';
import { PrintLayout } from './PrintLayout';

const METHOD: Record<string, string> = { cash: 'نقدًا / Cash', mada: 'مدى / Mada', credit_card: 'بطاقة ائتمان / Credit card', bank_transfer: 'تحويل بنكي / Bank transfer', deposit: 'من الرصيد / On account' };
const KIND: Record<string, string> = { payment: 'سند قبض / Payment receipt', installment: 'سند قبض قسط / Installment receipt', deposit: 'سند قبض دفعة مقدمة / Deposit receipt', refund: 'سند صرف (استرداد) / Refund receipt' };

function useQr(payload?: string) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (payload) void QRCode.toDataURL(payload, { margin: 1, width: 160, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [payload]);
  return src;
}

function Seller({ name, nameEn, vat, cr, address }: { name: string; nameEn: string; vat: string; cr?: string; address?: string }) {
  return (
    <Stack gap={0}>
      <Text size="sm" fw={600}>
        {name} {nameEn && `/ ${nameEn}`}
      </Text>
      {vat && <Text size="xs">الرقم الضريبي / VAT No: {vat}</Text>}
      {cr && <Text size="xs">السجل التجاري / CR: {cr}</Text>}
      {address && <Text size="xs">{address}</Text>}
    </Stack>
  );
}

/** Final invoice on A4 (SPEC 10.6, 10.7): simplified tax invoice with ZATCA QR. */
export function InvoicePrint() {
  const { lang, digits } = usePrefs();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['invoices', 'print', id], queryFn: () => api<Invoice>(`/invoices/${id}`) });
  const inv = q.data;
  const qr = useQr(inv?.qr_payload);
  const fm = (v: string) => formatMoney(v, lang, digits);
  return (
    <PrintLayout title={`فاتورة ضريبية مبسطة / Simplified tax invoice ${inv?.invoice_no ?? ''}`} ready={!!inv && !!qr}>
      {inv && (
        <Stack gap="sm" data-testid="invoice-print">
          <Group justify="space-between" align="flex-start">
            <Seller name={inv.seller_name_ar} nameEn={inv.seller_name_en} vat={inv.seller_vat_no} cr={inv.seller_cr_no} address={inv.seller_address_ar} />
            {qr && <Image src={qr} w={110} h={110} alt="ZATCA QR" />}
          </Group>
          <Group justify="space-between">
            <Stack gap={0}>
              <Text size="sm">
                رقم الفاتورة / Invoice No: <b dir="ltr">{inv.invoice_no}</b>
              </Text>
              <Text size="sm">التاريخ / Date: {formatDateTime(inv.issued_at, lang, digits)}</Text>
              <Text size="xs" dir="ltr">
                UUID {inv.uuid}
              </Text>
            </Stack>
            <Stack gap={0} align="flex-end">
              <Text size="sm">
                العميل / Customer: <b>{inv.buyer_name_ar}</b> {inv.buyer_name_en && `/ ${inv.buyer_name_en}`}
              </Text>
              <Text size="sm">
                رقم الملف / File No: {inv.buyer_file_no}
                {inv.buyer_national_id && ` · الهوية / ID: ${inv.buyer_national_id}`}
              </Text>
              {inv.insurance && (
                <Text size="sm">
                  التأمين / Insurance: {inv.insurance.company_name_ar} ({inv.insurance.class_name}) {inv.insurance.membership_no && `· ${inv.insurance.membership_no}`}
                </Text>
              )}
            </Stack>
          </Group>
          <Table className={classes.table} withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>الخدمة / Service</Table.Th>
                <Table.Th>الكمية / Qty</Table.Th>
                <Table.Th>السعر / Price</Table.Th>
                <Table.Th>الخصم / Discount</Table.Th>
                <Table.Th>الصافي / Net</Table.Th>
                <Table.Th>الضريبة / VAT</Table.Th>
                <Table.Th>الإجمالي / Total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {inv.lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    {l.description_ar}
                    {l.description_en && <div style={{ fontSize: 11 }}>{l.description_en}</div>}
                    {l.teeth.length > 0 && <div style={{ fontSize: 11 }}>{l.teeth.join(' ')}</div>}
                  </Table.Td>
                  <Table.Td>{l.qty}</Table.Td>
                  <Table.Td>{fm(l.price)}</Table.Td>
                  <Table.Td>{fm(l.discount)}</Table.Td>
                  <Table.Td>{fm(l.net)}</Table.Td>
                  <Table.Td>
                    {fm(l.vat_amount)} ({l.vat_rate}%)
                  </Table.Td>
                  <Table.Td>{fm(l.line_total)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Stack gap={2} align="flex-end">
            <Text size="sm">الإجمالي غير شامل الضريبة / Total excl. VAT: {fm(inv.net)}</Text>
            <Text size="sm">ضريبة القيمة المضافة / VAT: {fm(inv.vat)}</Text>
            <Text size="sm" fw={700}>
              الإجمالي شامل الضريبة / Total incl. VAT: {fm(inv.total)}
            </Text>
            {toCents(inv.insurance_share) > 0 && <Text size="sm">حصة التأمين / Insurance share: {fm(inv.insurance_share)}</Text>}
            <Text size="sm" fw={700}>
              حصة المريض / Patient share: {fm(inv.patient_share)}
            </Text>
            <Text size="sm">المتبقي / Outstanding: {fm(inv.outstanding)}</Text>
          </Stack>
          {inv.saudi && <Text size="xs">مواطن سعودي: معفى من ضريبة القيمة المضافة على الخدمات الصحية / Saudi citizen: healthcare VAT exempt</Text>}
          {inv.notes && <Text size="sm">{inv.notes}</Text>}
          <Text size="xs" c="dimmed">
            {inv.issued_by_name} · {inv.order_no}
          </Text>
        </Stack>
      )}
    </PrintLayout>
  );
}

/** Receipt on the receipt printer (80 mm). */
export function ReceiptPrint() {
  const { lang, digits } = usePrefs();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['receipts', 'print', id], queryFn: () => api<Receipt>(`/receipts/${id}`) });
  const r = q.data;
  const fm = (v: string) => formatMoney(v, lang, digits);
  return (
    <PrintLayout title={r ? KIND[r.kind] : ''} ready={!!r} size="slip">
      {r && (
        <Stack gap={4} data-testid="receipt-print">
          <Text size="sm">
            رقم السند / No: <b dir="ltr">{r.receipt_no}</b>
          </Text>
          <Text size="sm">{formatDateTime(r.received_at, lang, digits)}</Text>
          <Text size="sm">
            {r.patient_name_ar} · {r.patient_file_no}
          </Text>
          {r.payments.map((p, i) => (
            <Group key={i} justify="space-between">
              <Text size="sm">
                {METHOD[p.method]}
                {p.reference && ` (${p.reference})`}
              </Text>
              <Text size="sm">{fm(p.amount)}</Text>
            </Group>
          ))}
          <Group justify="space-between">
            <Text fw={700}>الإجمالي / Total</Text>
            <Text fw={700}>{fm(r.total)}</Text>
          </Group>
          {toCents(r.vat) > 0 && <Text size="xs">منها ضريبة / incl. VAT {fm(r.vat)}</Text>}
          {r.allocations.map((a) => (
            <Text key={a.invoice_id} size="xs">
              عن الفاتورة / For invoice <span dir="ltr">{a.invoice_no}</span>: {fm(a.amount)}
            </Text>
          ))}
          {r.credit_note_no && (
            <Text size="xs">
              إشعار دائن / Credit note <span dir="ltr">{r.credit_note_no}</span>
            </Text>
          )}
          {r.note && <Text size="xs">{r.note}</Text>}
          <Text size="xs">المستلم / By: {r.received_by_name}</Text>
        </Stack>
      )}
    </PrintLayout>
  );
}

export function CreditNotePrint() {
  const { lang, digits } = usePrefs();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['credit-notes', 'print', id], queryFn: () => api<CreditNote>(`/credit-notes/${id}`) });
  const c = q.data;
  const qr = useQr(c?.qr_payload);
  const fm = (v: string) => formatMoney(v, lang, digits);
  return (
    <PrintLayout title={`إشعار دائن / Credit note ${c?.credit_note_no ?? ''}`} ready={!!c && !!qr}>
      {c && (
        <Stack gap="sm" data-testid="credit-print">
          <Group justify="space-between" align="flex-start">
            <Seller name={c.seller_name_ar} nameEn={c.seller_name_en} vat={c.seller_vat_no} />
            {qr && <Image src={qr} w={110} h={110} alt="ZATCA QR" />}
          </Group>
          <Text size="sm">
            رقم الإشعار / No: <b dir="ltr">{c.credit_note_no}</b> · {formatDateTime(c.issued_at, lang, digits)}
          </Text>
          <Text size="sm">
            عن الفاتورة / For invoice: <span dir="ltr">{c.invoice_no}</span>
            {c.invoice_issued_at && ` (${formatDateTime(c.invoice_issued_at, lang, digits)})`}
          </Text>
          <Text size="sm">
            العميل / Customer: {c.buyer_name_ar} · {c.buyer_file_no}
          </Text>
          <Text size="sm">السبب / Reason: {c.reason}</Text>
          <Table className={classes.table} withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>الخدمة / Service</Table.Th>
                <Table.Th>الكمية / Qty</Table.Th>
                <Table.Th>الصافي / Net</Table.Th>
                <Table.Th>الضريبة / VAT</Table.Th>
                <Table.Th>الإجمالي / Total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {c.lines.map((l) => (
                <Table.Tr key={l.invoice_line_id}>
                  <Table.Td>
                    {l.description_ar}
                    {l.description_en && <div style={{ fontSize: 11 }}>{l.description_en}</div>}
                  </Table.Td>
                  <Table.Td>{l.qty}</Table.Td>
                  <Table.Td>{fm(l.net)}</Table.Td>
                  <Table.Td>
                    {fm(l.vat)} ({l.vat_rate}%)
                  </Table.Td>
                  <Table.Td>{fm(l.total)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Stack gap={2} align="flex-end">
            <Text size="sm">الصافي / Net: {fm(c.net)}</Text>
            <Text size="sm">الضريبة / VAT: {fm(c.vat)}</Text>
            <Text size="sm" fw={700}>
              الإجمالي / Total: {fm(c.total)}
            </Text>
            <Text size="sm">حصة المريض / Patient part: {fm(c.patient_share)}</Text>
            {toCents(c.refunded) > 0 && <Text size="sm">مسترد أو مضاف للرصيد / Refunded or kept on account: {fm(c.refunded)}</Text>}
          </Stack>
          <Text size="xs" c="dimmed">
            {c.issued_by_name}
          </Text>
        </Stack>
      )}
    </PrintLayout>
  );
}

export function ClosingPrint() {
  const { lang, digits } = usePrefs();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['cashbox', 'print', id], queryFn: () => api<Closing>(`/cash-box/closings/${id}`) });
  const c = q.data;
  return (
    <PrintLayout title="إقفال الصندوق / Cash box closing" ready={!!c}>
      {c && (
        <Stack gap="xs" data-testid="closing-print">
          <Text size="sm">
            المستخدم / User: <b>{c.user_name}</b> · أقفله / Closed by: {c.closed_by_name}
          </Text>
          <Text size="sm">
            من / From: {c.from_at ? formatDateTime(c.from_at, lang, digits) : '—'} · إلى / To: {formatDateTime(c.to_at, lang, digits)}
          </Text>
          <BoxTable totals={c.totals_json} />
          {c.note && <Text size="sm">ملاحظة / Note: {c.note}</Text>}
          <Group justify="space-between" mt="xl">
            <Text size="sm">توقيع المستخدم / User signature: ____________</Text>
            <Text size="sm">توقيع المحاسب / Accountant: ____________</Text>
          </Group>
        </Stack>
      )}
    </PrintLayout>
  );
}
