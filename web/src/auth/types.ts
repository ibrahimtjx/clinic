export interface RoleRef {
  id: number;
  key: string;
  name_ar: string;
  name_en: string;
}

export interface Preferences {
  lang: 'ar' | 'en' | null;
  theme: 'light' | 'dark' | null;
  digits: 'latn' | 'arab' | null;
}

export interface SecuritySettings {
  auto_lock_minutes: number;
  lockout_attempts: number;
  lockout_minutes: number;
}

export interface Me {
  id: number;
  username: string;
  full_name_ar: string;
  full_name_en: string;
  roles: RoleRef[];
  permissions: string[];
  has_pin: boolean;
  must_change_password: boolean;
  preferences: Preferences;
  security: SecuritySettings;
}

export interface TokenOut {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: Me;
}

export interface User {
  id: number;
  username: string;
  full_name_ar: string;
  full_name_en: string;
  is_active: boolean;
  department_id: number | null;
  roles: RoleRef[];
  has_pin: boolean;
  locked_until: string | null;
  failed_logins: number;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Role extends RoleRef {
  is_system: boolean;
  permissions: string[];
  version: number;
}

export interface Permission {
  key: string;
  group: string;
}

export interface AuditRow {
  id: number;
  at: string;
  user_id: number | null;
  user_name: string | null;
  machine: string | null;
  ip: string | null;
  table_name: string;
  record_id: string | null;
  action: string;
  old_json: Record<string, unknown> | null;
  new_json: Record<string, unknown> | null;
}

export interface Page<T> {
  items: T[];
  next_cursor: number | null;
}
