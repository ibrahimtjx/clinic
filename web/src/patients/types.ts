export interface Insurance {
  company_id: number;
  policy_no: string;
  class_name: string;
  class_id?: number | null;
  membership_no: string;
  expiry: string | null;
  company_name_ar?: string | null;
  company_name_en?: string | null;
}

export interface Patient {
  id: number;
  file_no: number;
  secondary_file_no: string | null;
  name_ar: string;
  name_en: string;
  national_id: string | null;
  nationality: string | null;
  gender: 'male' | 'female' | null;
  dob: string | null;
  mobile: string | null;
  phone: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  default_doctor_id: number | null;
  is_external: boolean;
  sms_opt_out: boolean;
  chronic_diseases: string;
  allergies: string;
  referral_source: string | null;
  notes: string;
  balance: string;
  deposit_balance?: string;
  last_visit_at: string | null;
  created_at: string;
  created_by: number | null;
  is_active: boolean;
  version: number;
  updated_at: string;
  deleted_at: string | null;
  insurance: Insurance | null;
}

export interface PatientListItem {
  id: number;
  file_no: number;
  name_ar: string;
  name_en: string;
  mobile: string | null;
  national_id: string | null;
  default_doctor_id: number | null;
  insurance_company_id: number | null;
  balance: string;
  last_visit_at: string | null;
  created_at: string;
  is_active: boolean;
}

export interface PatientQuick {
  id: number;
  file_no: number;
  name_ar: string;
  name_en: string;
  mobile: string | null;
  national_id: string | null;
  is_active: boolean;
}

export interface Duplicate {
  id: number;
  file_no: number;
  name_ar: string;
  name_en: string;
  matched_on: ('national_id' | 'mobile')[];
}

export interface Health {
  chronic_diseases: string;
  allergies: string;
  medications: string;
  medical_history: string;
  version: number;
}

export interface Assignment {
  id: number;
  patient_id: number;
  patient_name_ar: string | null;
  patient_name_en: string | null;
  patient_file_no: number | null;
  assigned_to: number;
  assigned_to_name: string | null;
  assigned_by: number;
  assigned_by_name: string | null;
  note: string;
  created_at: string;
  done_at: string | null;
}

export interface InsuranceCompany {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
  sort_order: number;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export interface PatientFilters {
  q?: string;
  doctor_id?: number | null;
  insurance_company_id?: number | null;
  has_balance?: boolean | null;
  created_from?: string | null;
  created_to?: string | null;
  include_inactive?: boolean;
  sort?: string | null;
}
