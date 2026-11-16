export type FilterKey = 'date_range' | 'day' | 'user' | 'doctor' | 'patient' | 'clinic' | 'method' | 'company' | 'patient_required';
export type ColType = 'text' | 'money' | 'int' | 'number' | 'date' | 'datetime' | 'time' | 'pct';

export interface ReportInfo {
  key: string;
  title_ar: string;
  title_en: string;
  group: 'financial' | 'operational';
  filters: FilterKey[];
  description_ar: string;
  description_en: string;
}

export interface ReportColumn {
  key: string;
  ar: string;
  en: string;
  type: ColType;
}

export interface ReportSection {
  key: string;
  title_ar: string;
  title_en: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
}

export interface ReportResult {
  key: string;
  title_ar: string;
  title_en: string;
  period: string;
  patient: { id: number; name_ar: string; file_no: number } | null;
  generated_at: string;
  sections: ReportSection[];
  summary: { ar: string; en: string; type: ColType; value: string | number | null }[];
  notes_ar: string[];
  notes_en: string[];
}

export interface ReportOptions {
  users: { id: number; name_ar: string; name_en: string }[];
  doctors: { id: number; name_ar: string; name_en: string }[];
  clinics: { id: number; name_ar: string; name_en: string }[];
  companies: { id: number; name_ar: string; name_en: string }[];
}
