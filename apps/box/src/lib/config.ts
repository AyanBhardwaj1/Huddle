import { BRIDGE_DEFAULT_URL, wsUrlFor } from '@huddle/shared';

/**
 * Engine base URL. Production: same origin (the engine serves /box/). Dev: Vite proxies the engine
 * routes, so same origin works too. `VITE_ENGINE_URL` overrides (e.g. a box UI on a laptop talking
 * to an engine on the Pi).
 */
export function engineBase(): string {
  const env = import.meta.env.VITE_ENGINE_URL;
  if (env) return env.replace(/\/$/, '');
  return window.location.origin;
}

export function engineWsUrl(): string {
  return wsUrlFor(engineBase());
}

/** Resolve an engine path (`/audio/abc`) or absolute URL against the engine base. */
export function engineUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, engineBase() + '/').toString();
}

export function bridgeUrl(): string {
  return import.meta.env.VITE_BRIDGE_URL || BRIDGE_DEFAULT_URL;
}

/** `?fixture=1|live|lobby|end|scorecard` renders from a static snapshot without an engine. */
export type FixtureKind = 'live' | 'lobby' | 'end' | 'scorecard';
export function fixtureParam(search = window.location.search): FixtureKind | null {
  const v = new URLSearchParams(search).get('fixture');
  if (v === null) return null;
  if (v === 'lobby' || v === 'end' || v === 'scorecard') return v;
  return 'live';
}
