export interface PatientBrief {
  id: number;
  file_no: number;
  name_ar: string;
  name_en: string;
  mobile: string | null;
  is_insured: boolean;
  has_balance: boolean;
  is_new: boolean;
  appointment_count: number;
}

export interface Appointment {
  id: number;
  patient_id: number;
  doctor_id: number;
  clinic_id: number | null;
  starts_at: string;
  ends_at: string;
  status_id: number;
  blocks_slot: boolean;
  visit_type_id: number | null;
  service_id: number | null;
  is_waiting_list: boolean;
  note: string;
  exclude_sms: boolean;
  confirmed_by: number | null;
  confirmed_at: string | null;
  cancel_reason: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
  patient: PatientBrief | null;
  created_by_name: string | null;
  confirmed_by_name: string | null;
}

export interface FreeSlot {
  doctor_id: number;
  starts_at: string;
  ends_at: string;
}

export interface WaitingEntry {
  id: number;
  patient_id: number;
  patient_name_ar: string;
  patient_name_en: string;
  patient_file_no: number;
  patient_mobile: string | null;
  doctor_id: number | null;
  appointment_id: number | null;
  appointment_starts_at: string | null;
  preferred_days: number[];
  preferred_from: string | null;
  preferred_to: string | null;
  note: string;
  created_at: string;
  resolved_at: string | null;
  version: number;
}

/** What the booking drawer opens with. */
export interface DraftAppointment {
  id?: number;
  patient_id?: number | null;
  patient_label?: string;
  doctor_id?: number | null;
  date?: string;
  start?: number; // minutes since midnight
  duration?: number;
  visit_type_id?: number | null;
  service_id?: number | null;
  note?: string;
  waitingEntryId?: number; // resolve this waiting-list entry when saved
}
