export const COLORS = ['neutral', 'red', 'pink', 'grape', 'violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange'] as const;
export type ColorName = (typeof COLORS)[number];

export interface Base {
  id: number;
  is_active: boolean;
  sort_order: number;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export interface Clinic extends Base {
  name_ar: string;
  name_en: string;
}
export interface Department extends Clinic {
  clinic_id: number | null;
}
export interface AppointmentStatus extends Base {
  key: string;
  name_ar: string;
  name_en: string;
  color: ColorName;
  blocks_slot: boolean;
  is_system: boolean;
}
export interface VisitType extends Base {
  name_ar: string;
  name_en: string;
  color: ColorName;
}
export interface ReferralSource extends Base {
  name_ar: string;
  name_en: string;
}
export const PHRASE_FIELDS = [
  'appointment_note',
  'chief_complaint',
  'diagnosis',
  'procedure',
  'preventive_advice',
  'complications',
  'patient_education',
  'next_visit',
  'reception_note',
] as const;
export type PhraseField = (typeof PHRASE_FIELDS)[number];
export interface SavedPhrase extends Base {
  field_key: PhraseField;
  text: string;
}
/** Money is a decimal string from the API (NUMERIC(12,2)); never parsed to float for storage. */
export interface Service extends Base {
  number: number;
  code: string;
  name_ar: string;
  name_en: string;
  department_id: number | null;
  sale_price: string;
  min_price: string;
  max_price: string;
  cost_price: string;
  vat_applicable: boolean;
  is_consultation: boolean;
}
export interface ScheduleItem {
  id?: number;
  weekday: number;
  start_time: string;
  end_time: string;
  kind: 'work' | 'break';
}
export interface CommissionRule {
  id?: number;
  department_id: number | null;
  service_id: number | null;
  percent: string;
}
export interface Doctor extends Base {
  user_id: number | null;
  name_ar: string;
  name_en: string;
  specialty_ar: string;
  specialty_en: string;
  clinic_id: number | null;
  department_id: number | null;
  color: ColorName;
  slot_minutes: number;
  room: string;
  schedules: ScheduleItem[];
  commission_rules: CommissionRule[] | null;
}
export interface ClinicInfo {
  name_ar: string;
  name_en: string;
  address_ar: string;
  address_en: string;
  phone: string;
  email: string;
  vat_number: string;
  cr_number: string;
}
export type DocType = 'quotation' | 'payment_order' | 'invoice' | 'credit_note' | 'receipt';
export interface NumberFormat {
  prefix: string;
  yearly_reset: boolean;
  padding: number;
}
export type Numbering = Record<DocType, { format: NumberFormat; next_number: string; issued: number }>;
