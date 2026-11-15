/** All server access goes through the API under /api (SPEC 2 Rules). */
export const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

export interface Health {
  status: 'ok';
  version: string;
  database: 'ok';
  server_time: string;
  timezone: string;
}
