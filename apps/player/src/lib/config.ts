import { wsUrlFor } from '@huddle/shared';

/**
 * Engine base URL. Same origin in production (the engine serves this app at `/`); in dev Vite proxies
 * the engine routes to :8080. `VITE_ENGINE_URL` overrides both (e.g. a tunnel URL).
 */
const ENGINE_KEY = 'huddle.engine';

/**
 * Runtime engine override for static hosting (e.g. the Vercel deploy, where the engine runs elsewhere):
 * open the app once with `?engine=https://your-engine.example` and it is remembered on this device.
 * `?engine=` (empty) clears it.
 */
function runtimeEngine(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const param = new URLSearchParams(window.location.search).get('engine');
    if (param !== null) {
      const v = param.trim().replace(/\/$/, '');
      if (v && /^https?:\/\//.test(v)) window.localStorage.setItem(ENGINE_KEY, v);
      else window.localStorage.removeItem(ENGINE_KEY);
    }
    return window.localStorage.getItem(ENGINE_KEY);
  } catch {
    return null;
  }
}

export function engineBase(): string {
  const rt = runtimeEngine();
  if (rt) return rt;
  const env = (import.meta.env.VITE_ENGINE_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, '');
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080';
}

export function engineWsUrl(): string {
  return wsUrlFor(engineBase());
}

/** Resolve an engine-relative path (e.g. an announcer `audioUrl` like `/audio/abc.mp3`). */
export function engineUrl(path: string): string {
  return new URL(path, engineBase() + '/').toString();
}
