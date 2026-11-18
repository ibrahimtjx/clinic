import type { Base } from '../master/types';

export const FILE_KINDS = ['xray', 'panoramic', 'ceph', 'cbct', 'intraoral', 'extraoral', 'document', 'consent', 'lab_result', 'referral', 'id_card', 'insurance_card', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export interface PatientFile {
  id: number;
  patient_id: number;
  visit_id: number | null;
  tooth_fdi: number | null;
  kind: FileKind;
  title: string;
  taken_on: string;
  original_name: string;
  content_type: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  has_thumb: boolean;
  created_at: string;
  created_by: number | null;
  version: number;
  uploaded_by_name: string | null;
}

export interface Medication extends Base {
  name: string;
  form: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface LabTest extends Base {
  code: string;
  name_ar: string;
  name_en: string;
  unit: string;
  reference_range: string;
}

interface DocBase {
  id: number;
  patient_id: number;
  doctor_id: number;
  visit_id: number | null;
  issued_at: string;
  status: 'active' | 'resulted' | 'cancelled';
  cancel_reason: string | null;
  notes: string;
  version: number;
  editable: boolean;
  doctor_name_ar: string;
  doctor_name_en: string;
  written_by_name: string | null;
}

export interface RxItem {
  drug: string;
  form: string;
  dose: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
}

export interface Prescription extends DocBase {
  diagnosis: string;
  items: (RxItem & { seq: number })[];
}

export interface LabItem {
  test_id: number | null;
  name: string;
  unit: string;
  reference_range: string;
}

export interface LabRequest extends DocBase {
  lab_name: string;
  clinical_info: string;
  resulted_at: string | null;
  result_note: string;
  resulted_by_name: string | null;
  items: (LabItem & { seq: number; result: string; flag: 'normal' | 'low' | 'high' | 'abnormal' | null })[];
}

export interface MedicalReport extends DocBase {
  kind: 'report' | 'referral' | 'attendance' | 'sick_leave';
  language: 'ar' | 'en';
  recipient: string;
  title: string;
  body: string;
  leave_from: string | null;
  leave_to: string | null;
  leave_days: number | null;
}
