import type { InsuranceSnapshot } from './types';

export type Method = 'cash' | 'mada' | 'credit_card' | 'bank_transfer' | 'deposit';
export const METHODS: Method[] = ['cash', 'mada', 'credit_card', 'bank_transfer', 'deposit'];

export interface PaymentRow {
  key: string;
  method: Method;
  amount: string;
  reference: string;
}

export interface InvoiceLine {
  id: number;
  seq: number;
  service_id: number | null;
  description_ar: string;
  description_en: string;
  price: string;
  qty: string;
  discount: string;
  net: string;
  vat_rate: string;
  vat_amount: string;
  line_total: string;
  patient_share: string;
  insurance_share: string;
  teeth: number[];
  credited_qty: string;
}

export interface CreditBrief {
  id: number;
  credit_note_no: string;
  issued_at: string;
  reason: string;
  total: string;
  patient_share: string;
  refunded: string;
}

export interface Invoice {
  id: number;
  invoice_no: string;
  uuid: string;
  payment_order_id: number;
  patient_id: number;
  doctor_id: number | null;
  plan_id: number | null;
  installment_id: number | null;
  issued_at: string;
  issued_by: number;
  notes: string;
  insurance: InsuranceSnapshot | null;
  buyer_name_ar: string;
  buyer_name_en: string;
  buyer_national_id: string;
  buyer_nationality: string;
  buyer_file_no: number;
  saudi: boolean;
  seller_name_ar: string;
  seller_name_en: string;
  seller_vat_no: string;
  seller_cr_no: string;
  seller_address_ar: string;
  gross: string;
  discount: string;
  net: string;
  vat: string;
  total: string;
  insurance_share: string;
  patient_share: string;
  previous_hash: string;
  hash: string;
  qr_payload: string;
  outstanding: string;
  credited: string;
  portion: string;
  corrects_invoice_id: number | null;
  corrects_invoice_no: string | null;
  corrected_by: { id: number; invoice_no: string }[];
  issued_by_name: string | null;
  doctor_name_ar: string | null;
  order_no: string | null;
  lines: InvoiceLine[];
  credit_notes: CreditBrief[];
  receipts: { id: number; receipt_no: string; kind: string; received_at: string; amount: string }[];
}

export interface Receipt {
  id: number;
  receipt_no: string;
  kind: 'payment' | 'deposit' | 'refund' | 'installment';
  patient_id: number;
  invoice_id: number | null;
  credit_note_id: number | null;
  plan_id: number | null;
  received_by: number;
  received_at: string;
  total: string;
  vat: string;
  note: string;
  received_by_name: string | null;
  patient_name_ar: string;
  patient_name_en: string;
  patient_file_no: number;
  credit_note_no: string | null;
  payments: { method: Method; amount: string; reference: string }[];
  allocations: { invoice_id: number; invoice_no: string; amount: string }[];
  balance_after: string | null;
  deposit_after: string | null;
}

export interface CreditNote extends CreditBrief {
  uuid: string;
  invoice_id: number;
  invoice_no: string;
  invoice_issued_at: string | null;
  patient_id: number;
  issued_by_name: string | null;
  net: string;
  vat: string;
  insurance_share: string;
  balance_reduced: string;
  hash: string;
  previous_hash: string;
  qr_payload: string;
  buyer_name_ar: string;
  buyer_name_en: string;
  buyer_file_no: number;
  seller_name_ar: string;
  seller_name_en: string;
  seller_vat_no: string;
  lines: { invoice_line_id: number; qty: string; net: string; vat: string; total: string; patient_share: string; insurance_share: string; description_ar: string; description_en: string; price: string; vat_rate: string }[];
  refund_receipt_id: number | null;
}

export interface UnpaidOrder {
  id: number;
  order_no: string;
  sent_at: string | null;
  doctor_name_ar: string | null;
  patient_share: string;
  paid_amount: string;
  remaining: string;
  version: number;
}

export interface Account {
  patient_id: number;
  balance: string;
  deposit_balance: string;
  unpaid: Invoice[];
  unpaid_orders: UnpaidOrder[];
  receipts: Receipt[];
}

export interface Split {
  net: string;
  vat: string;
  total: string;
}

export interface BoxTotals {
  from_at: string | null;
  to_at: string;
  count: number;
  methods: { method: Method; in: Split; out: Split; net: Split }[];
  in: Split;
  out: Split;
  net: Split;
  deposits_taken: string;
  deposit_used: string;
  credit_to_deposit: string;
}

export interface Closing {
  id: number;
  user_id: number;
  from_at: string | null;
  to_at: string;
  totals_json: BoxTotals;
  note: string;
  closed_by: number;
  closed_at: string;
  user_name: string | null;
  closed_by_name: string | null;
}
