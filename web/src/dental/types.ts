export interface Addendum {
  id: number;
  text: string;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
}

export interface DentalVisit {
  id: number;
  patient_id: number;
  doctor_id: number;
  department_id: number | null;
  appointment_id: number | null;
  visit_at: string;
  teeth: number[];
  chief_complaint: string;
  diagnosis: string;
  icd10: string | null;
  procedure: string;
  treatment_note: string;
  preventive_advice: string;
  complications: string;
  patient_education: string;
  next_visit: string;
  note: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  version: number;
  created_by_name: string | null;
  editable_until: string | null;
  can_edit: boolean;
  addenda: Addendum[];
}

export interface Finding {
  id: number;
  patient_id: number;
  tooth_fdi: number;
  category: string;
  description: string;
  visit_id: number | null;
  created_at: string;
  created_by: number | null;
}

export interface DentalRecord {
  visits: DentalVisit[];
  findings: Finding[];
  edit_hours: number;
}

export const TEXT_FIELDS = [
  'chief_complaint',
  'diagnosis',
  'procedure',
  'treatment_note',
  'preventive_advice',
  'complications',
  'patient_education',
  'next_visit',
  'note',
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
