/** All server access goes through the API under /api (SPEC 2 Rules). */
export const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: ApiErrorDetail | null,
  ) {
    super(detail?.code ?? `http_${status}`);
  }
  get code(): string {
    return this.detail?.code ?? (this.status === 0 ? 'network' : `http_${this.status}`);
  }
}

export interface ApiErrorDetail {
  code: string;
  [k: string]: unknown;
}

// ---- auth wiring (set by AuthProvider) ----
let accessToken: string | null = null;
let refreshAccess: (() => Promise<string | null>) | null = null;
let onSessionEnded: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function configureAuth(opts: { refresh: () => Promise<string | null>; sessionEnded: () => void }) {
  refreshAccess = opts.refresh;
  onSessionEnded = opts.sessionEnded;
}

// ---- client machine name (audit log "machine"; the desktop app supplies the PC name from M10) ----
const MACHINE_KEY = 'clinic.machine';
export function getMachineName(): string {
  try {
    let name = localStorage.getItem(MACHINE_KEY);
    if (!name) {
      name = `PC-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      localStorage.setItem(MACHINE_KEY, name);
    }
    return name;
  } catch {
    return 'browser';
  }
}
export function setMachineName(name: string) {
  try {
    localStorage.setItem(MACHINE_KEY, name.trim().slice(0, 64));
  } catch {
    /* storage unavailable */
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** false for sign-in endpoints that rely on the cookie or credentials only. */
  auth?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query) {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Client-Machine': getMachineName() };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') throw e;
    throw new ApiError(0, { code: 'network' });
  }
}

async function detailOf(res: Response): Promise<ApiErrorDetail | null> {
  const body = await res.json().catch(() => null);
  const d = body?.detail;
  if (d && typeof d === 'object' && !Array.isArray(d) && 'code' in d) return d as ApiErrorDetail;
  if (res.status === 422) return { code: 'validation', errors: d };
  return null;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts, accessToken);
  if (res.status === 401 && opts.auth !== false) {
    const detail = await detailOf(res);
    if (detail?.code === 'token_expired' && refreshAccess) {
      const token = await refreshAccess();
      if (token) res = await send(path, opts, token);
    } else {
      onSessionEnded?.();
      throw new ApiError(401, detail);
    }
    if (res.status === 401) {
      onSessionEnded?.();
      throw new ApiError(401, await detailOf(res));
    }
  }
  if (!res.ok) throw new ApiError(res.status, await detailOf(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => api<T>(path, opts);

export interface Health {
  status: 'ok';
  version: string;
  database: 'ok';
  server_time: string;
  timezone: string;
}

/**
 * Downloads a file from an authenticated endpoint (a plain link cannot carry the bearer token)
 * and saves it with the server's file name.
 */
export async function apiDownload(path: string, query?: Query, fallbackName = 'download'): Promise<void> {
  let res = await send(path, { query }, accessToken);
  if (res.status === 401 && refreshAccess) {
    const token = await refreshAccess();
    if (token) res = await send(path, { query }, token);
  }
  if (!res.ok) throw new ApiError(res.status, await detailOf(res));
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1];
  const name = utf8 ? decodeURIComponent(utf8) : (/filename="(.+)"/.exec(cd)?.[1] ?? fallbackName);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

