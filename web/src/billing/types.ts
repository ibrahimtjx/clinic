export interface DocLine {
  seq: number;
  service_id: number | null;
  description_ar: string;
  description_en: string;
  price: string;
  qty: string;
  discount_amount: string;
  discount_pct: string;
  gross: string;
  discount: string;
  net: string;
  vat_rate: string;
  vat_amount: string;
  line_total: string;
  patient_share: string;
  insurance_share: string;
  teeth: number[];
  price_overridden: boolean;
}

export interface InsuranceSnapshot {
  company_id: number | null;
  company_name_ar: string | null;
  company_name_en: string | null;
  class_id: number | null;
  class_name: string;
  policy_no: string;
  membership_no: string;
  expiry: string | null;
  patient_share_pct: string | null;
  max_patient_share_per_invoice: string | null;
  consultation_max_covered: string | null;
  daily_limit: string | null;
}

export interface Totals {
  gross: string;
  discount: string;
  net: string;
  vat: string;
  total: string;
  insurance_share: string;
  patient_share: string;
}

export interface Preview extends Totals {
  lines: DocLine[];
  insurance: InsuranceSnapshot | null;
  saudi: boolean;
  notes: string[];
}

export type DocKind = 'quotation' | 'payment_order';

export interface BillingDoc extends Totals {
  id: number;
  patient_id: number;
  doctor_id: number | null;
  clinic_id: number | null;
  plan_id: number | null;
  notes: string;
  insurance: InsuranceSnapshot | null;
  saudi: boolean;
  status: string;
  created_at: string;
  created_by: number | null;
  updated_at: string;
  version: number;
  lines: DocLine[];
  patient_name_ar: string;
  patient_name_en: string;
  patient_file_no: number;
  created_by_name: string | null;
  // quotation
  quotation_no?: string;
  valid_until?: string | null;
  // payment order
  order_no?: string;
  quotation_id?: number | null;
  installment_id?: number | null;
  reception_note?: string;
  sent_at?: string | null;
  sent_by_name?: string | null;
}

export interface EditLine {
  key: string;
  service_id: number | null;
  description_ar: string;
  description_en: string;
  price: string;
  qty: string;
  discount_mode: 'amount' | 'pct';
  discount: string;
  teeth: string;
}

export interface InsuranceClass {
  id: number;
  company_id: number;
  name: string;
  patient_share_pct: string;
  max_patient_share_per_invoice: string | null;
  consultation_max_covered: string | null;
  daily_limit: string | null;
  excluded_service_ids: number[];
  is_active: boolean;
  sort_order: number;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export interface Plan {
  id: number;
  patient_id: number;
  doctor_id: number;
  department_id: number | null;
  title: string;
  status: 'draft' | 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
  total_price: string;
  discount: string;
  net_price: string;
  paid: string;
  remaining: string;
  installments_total: string;
  accepted_option_id: number | null;
  accepted_at: string | null;
  notes: string;
  options: { id: number; title: string; price: string; description: string }[];
  sessions: { id: number; seq: number; description: string; service_id: number | null; teeth: number[]; price_share: string; status: 'planned' | 'booked' | 'done' }[];
  installments: { id: number; due_date: string; amount: string; paid_amount: string; overdue: boolean }[];
  created_at: string;
  updated_at: string;
  version: number;
  patient_name_ar: string;
  patient_file_no: number;
}
