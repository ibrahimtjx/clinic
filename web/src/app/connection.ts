import { useQuery } from '@tanstack/react-query';

import { apiGet, type Health } from '../lib/api';

export type ConnectionState = 'checking' | 'online' | 'offline';

/**
 * Server connection indicator (SPEC 4.3). Polls /api/health. When the server is unreachable
 * the shell shows a banner and actions are disabled. There are no local offline writes.
 */
export function useConnection() {
  const q = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<Health>('/health', { auth: false, signal: AbortSignal.timeout(4000) }),
    refetchInterval: (query) => (query.state.status === 'error' ? 3_000 : 10_000),
    refetchIntervalInBackground: true,
    retry: false,
    staleTime: 0,
  });
  const state: ConnectionState = q.isPending ? 'checking' : q.isError ? 'offline' : 'online';
  return { state, online: state === 'online', health: q.data, retry: () => void q.refetch(), isFetching: q.isFetching };
}
