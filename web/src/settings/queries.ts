import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AuditRow, Page, Permission, Role, SecuritySettings, User } from '../auth/types';
import { api } from '../lib/api';

export const keys = {
  users: ['users'] as const,
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
  security: ['settings', 'security'] as const,
  audit: (f: object) => ['audit', f] as const,
};

export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: () => api<User[]>('/users') });
export const useRoles = (enabled = true) => useQuery({ queryKey: keys.roles, queryFn: () => api<Role[]>('/roles'), enabled });
export const usePermissions = () => useQuery({ queryKey: keys.permissions, queryFn: () => api<Permission[]>('/permissions'), staleTime: Infinity });
export const useSecurity = () => useQuery({ queryKey: keys.security, queryFn: () => api<SecuritySettings>('/settings/security') });

export function useUserAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: 'unlock' | 'deactivate' | 'activate' | 'reset-password' | 'pin'; body?: unknown }) =>
      action === 'pin'
        ? api<User>(`/users/${id}/pin`, { method: 'DELETE' })
        : api<User>(`/users/${id}/${action}`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users }),
  });
}

export interface AuditFilters {
  table_name?: string;
  action?: string;
  user_id?: number | null;
  record_id?: string;
}

export const fetchAudit = (f: AuditFilters, before_id?: number) =>
  api<Page<AuditRow>>('/audit', { query: { ...f, before_id, limit: 50 } });
