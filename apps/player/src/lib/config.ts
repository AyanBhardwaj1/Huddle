import { wsUrlFor } from '@huddle/shared';

/**
 * Engine base URL. Same origin in production (the engine serves this app at `/`); in dev Vite proxies
 * the engine routes to :8080. `VITE_ENGINE_URL` overrides both (e.g. a tunnel URL).
 */
export function engineBase(): string {
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
