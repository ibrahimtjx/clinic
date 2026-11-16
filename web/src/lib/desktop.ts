/**
 * Bridge to the Windows desktop app (SPEC 2, 3.8, milestone M10). The same web app runs in a normal
 * browser, where none of this exists and everything falls back to browser behaviour.
 */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function core(): { invoke: Invoke } | undefined {
  return (window as unknown as { __TAURI__?: { core?: { invoke: Invoke } } }).__TAURI__?.core;
}

export const isDesktop = (): boolean => !!core();

export function desktop<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const c = core();
  if (!c) return Promise.reject(new Error('not_desktop'));
  return c.invoke<T>(cmd, args);
}

export interface DesktopInfo {
  version: string;
  machine: string;
  server: string | null;
  a4_printer: string;
  receipt_printer: string;
}
