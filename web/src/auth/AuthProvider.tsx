import { useMantineColorScheme } from '@mantine/core';
import { useIdle } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { usePrefs } from '../app/preferences';
import { api, configureAuth, setAccessToken } from '../lib/api';
import type { Me, Preferences, TokenOut } from './types';

/**
 * Session lifecycle (SPEC 3.3).
 * - Access token lives in memory only; the refresh token is an HttpOnly cookie.
 * - Locking ends the session on the server. The app stays mounted under the lock screen, so open
 *   work is kept; unlocking or switching user signs in again with a PIN or password.
 * - Every action is recorded under whoever is signed in at that moment.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'locked';

interface AuthCtx {
  status: AuthStatus;
  me: Me | null;
  /** The user shown on the lock screen (whoever was signed in when it locked). */
  lockedUser: Me | null;
  can: (perm: string) => boolean;
  canAny: (...perms: string[]) => boolean;
  login: (username: string, password: string) => Promise<Me>;
  pinLogin: (username: string, pin: string) => Promise<Me>;
  lock: () => Promise<void>;
  logout: () => Promise<void>;
  /** Apply a fresh profile or token returned by /auth/me endpoints. */
  applyMe: (me: Me) => void;
  applyToken: (t: TokenOut) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { lang, setLang, digits, setDigits, font, setFont, fontScale, setFontScale } = usePrefs();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [lockedUser, setLockedUser] = useState<Me | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refreshing = useRef<Promise<string | null> | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const applyPrefs = useCallback(
    (p: Preferences) => {
      if (p.lang) setLang(p.lang);
      if (p.theme) setColorScheme(p.theme);
      if (p.digits) setDigits(p.digits);
      if (p.font) setFont(p.font);
      if (p.font_scale) setFontScale(p.font_scale);
    },
    [setLang, setColorScheme, setDigits, setFont, setFontScale],
  );

  const refresh = useCallback((initial = false): Promise<string | null> => {
    // One refresh at a time, shared by all callers.
    refreshing.current ??= api<TokenOut>('/auth/refresh', { method: 'POST', auth: false })
      .then((t) => {
        accept(t, initial);
        return t.access_token;
      })
      .catch(() => null)
      .finally(() => {
        refreshing.current = null;
      });
    return refreshing.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedule = useCallback(
    (expiresIn: number) => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(false), Math.max(10, expiresIn - 60) * 1000);
    },
    [refresh],
  );

  function accept(t: TokenOut, fresh: boolean) {
    setAccessToken(t.access_token);
    schedule(t.expires_in);
    const previous = meRef.current;
    setMe(t.user);
    setStatus('signedIn');
    setLockedUser(null);
    if (fresh) {
      applyPrefs(t.user.preferences);
      // A different user now: drop cached data fetched with the previous user's permissions.
      if (previous && previous.id !== t.user.id) qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'health' });
    }
  }

  const endLocally = useCallback(
    (next: AuthStatus) => {
      clearTimeout(refreshTimer.current);
      setAccessToken(null);
      if (next === 'locked') setLockedUser(meRef.current);
      if (next === 'signedOut') {
        setMe(null);
        setLockedUser(null);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'health' });
      }
      setStatus(next);
    },
    [qc],
  );

  useEffect(() => {
    configureAuth({
      refresh: () => refresh(),
      // The server ended the session (signed out elsewhere, deactivated, password reset).
      sessionEnded: () => endLocally(meRef.current ? 'locked' : 'signedOut'),
    });
    // Resume an existing session (page reload); the profile's language and theme apply.
    void refresh(true).then((token) => {
      if (!token) setStatus('signedOut');
    });
    return () => clearTimeout(refreshTimer.current);
  }, [refresh, endLocally]);

  // Keep preference changes on the server profile so they follow the user to any PC.
  useEffect(() => {
    if (status !== 'signedIn' || !me) return;
    const p = me.preferences;
    const theme = colorScheme === 'dark' ? 'dark' : 'light';
    if (p.lang === lang && p.theme === theme && p.digits === digits && (p.font ?? 'plex') === font && (p.font_scale ?? 100) === fontScale) return;
    const id = setTimeout(() => {
      api<Me>('/auth/me/preferences', { method: 'PATCH', body: { lang, theme, digits, font, font_scale: fontScale } })
        .then(setMe)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [status, me, lang, colorScheme, digits, font, fontScale]);

  const login = useCallback(async (username: string, password: string) => {
    const t = await api<TokenOut>('/auth/login', { method: 'POST', body: { username, password }, auth: false });
    accept(t, true);
    return t.user;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pinLogin = useCallback(async (username: string, pin: string) => {
    const t = await api<TokenOut>('/auth/pin-login', { method: 'POST', body: { username, pin }, auth: false });
    accept(t, true);
    return t.user;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lock = useCallback(async () => {
    endLocally('locked');
    await api('/auth/lock', { method: 'POST', auth: false }).catch(() => {});
  }, [endLocally]);

  const logout = useCallback(async () => {
    endLocally('signedOut');
    await api('/auth/logout', { method: 'POST', auth: false }).catch(() => {});
  }, [endLocally]);

  // Auto-lock after inactivity (default 5 minutes, configurable in Settings → Security).
  const idleMs = (me?.security.auto_lock_minutes ?? 5) * 60_000;
  const idle = useIdle(idleMs, { initialState: false });
  useEffect(() => {
    if (idle && status === 'signedIn') void lock();
  }, [idle, status, lock]);

  const value = useMemo<AuthCtx>(() => {
    const perms = new Set(me?.permissions ?? []);
    return {
      status,
      me,
      lockedUser,
      can: (p) => perms.has(p),
      canAny: (...ps) => ps.some((p) => perms.has(p)),
      login,
      pinLogin,
      lock,
      logout,
      applyMe: setMe,
      applyToken: (t) => accept(t, false),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, me, lockedUser, login, pinLogin, lock, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Display name in the current UI language. */
export function displayName(u: { full_name_ar: string; full_name_en: string; username: string }, lang: 'ar' | 'en') {
  return (lang === 'en' ? u.full_name_en || u.full_name_ar : u.full_name_ar || u.full_name_en) || u.username;
}
