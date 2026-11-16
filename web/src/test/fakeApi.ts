import { vi } from 'vitest';

import type { Me, TokenOut } from '../auth/types';

export const health = { status: 'ok', version: '0.2.0', database: 'ok', server_time: '2026-11-15T16:05:00+03:00', timezone: 'Asia/Riyadh' };

export function makeMe(over: Partial<Me> = {}): Me {
  return {
    id: 1,
    username: 'amal',
    full_name_ar: 'أمل الغامدي',
    full_name_en: 'Amal Alghamdi',
    roles: [{ id: 3, key: 'reception', name_ar: 'الاستقبال', name_en: 'Reception' }],
    permissions: ['patient.view', 'appointment.view', 'appointment.create', 'queue.view', 'payment.collect'],
    has_pin: true,
    must_change_password: false,
    preferences: { lang: null, theme: null, digits: null },
    security: { auto_lock_minutes: 5, lockout_attempts: 5, lockout_minutes: 15 },
    ...over,
  };
}

export const token = (user: Me): TokenOut => ({ access_token: `tok-${user.id}-${Math.random()}`, token_type: 'bearer', expires_in: 900, user });

type Reply = [number, unknown] | [number, unknown, Record<string, string>];
type Handler = (body: unknown, init: RequestInit) => Reply | Promise<Reply>;

/**
 * Minimal in-memory API: routes keyed by "METHOD /path". Unknown routes return 404.
 * `signedIn` controls whether the refresh cookie is "present" at startup.
 */
export function fakeApi(opts: { me?: Me | null; online?: boolean; routes?: Record<string, Handler> } = {}) {
  let current: Me | null = opts.me === undefined ? makeMe() : opts.me;
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string>; query: Record<string, string> }[] = [];
  const routes: Record<string, Handler> = {
    'GET /api/health': () => [200, health],
    'POST /api/auth/refresh': () => (current ? [200, token(current)] : [401, { detail: { code: 'session_ended' } }]),
    'POST /api/auth/lock': () => [204, null],
    'POST /api/auth/logout': () => {
      current = null;
      return [204, null];
    },
    'PATCH /api/auth/me/preferences': (b) => {
      if (current) current = { ...current, preferences: { ...current.preferences, ...(b as object) } };
      return [200, current];
    },
    ...opts.routes,
  };
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).split('?')[0];
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const query = Object.fromEntries(new URLSearchParams(String(url).split('?')[1] ?? ''));
    calls.push({ method, path, body, headers: (init.headers ?? {}) as Record<string, string>, query });
    if (opts.online === false) throw new TypeError('network');
    const h = routes[`${method} ${path}`];
    const [status, payload, headers] = h ? await h(body, init) : ([404, { detail: { code: 'not_found' } }] as Reply);
    return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    setUser: (u: Me | null) => {
      current = u;
    },
    on: (key: string, h: Handler) => {
      routes[key] = h;
    },
  };
}
