export type Stage = 'waiting' | 'called' | 'with_doctor' | 'done' | 'left';

export interface QueueEntry {
  id: number;
  day: string;
  queue_no: number;
  patient_id: number;
  doctor_id: number;
  clinic_id: number | null;
  appointment_id: number | null;
  received_at: string;
  received_by: number;
  called_at: string | null;
  called_by: number | null;
  entered_at: string | null;
  entered_by: number | null;
  exited_at: string | null;
  exited_by: number | null;
  postponed: boolean;
  note: string;
  cancelled_at: string | null;
  version: number;
  stage: Stage;
  waited_minutes: number;
  patient_name_ar: string;
  patient_name_en: string;
  patient_file_no: number;
  visit_type_id: number | null;
  user_names: Record<string, string | null>;
}

export interface QueueReport {
  items: QueueEntry[];
  total: number;
  seen: number;
  not_seen: number;
  average_wait_minutes: number | null;
}

export interface QueueSettings {
  warn_minutes: number;
  late_minutes: number;
}
