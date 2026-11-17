import { BRIDGE_DEFAULT_URL, wsUrlFor } from '@huddle/shared';

/**
 * Engine base URL. Production: same origin (the engine serves /box/). Dev: Vite proxies the engine
 * routes, so same origin works too. `VITE_ENGINE_URL` overrides (e.g. a box UI on a laptop talking
 * to an engine on the Pi).
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
  const env = import.meta.env.VITE_ENGINE_URL;
  if (env) return env.replace(/\/$/, '');
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080';
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

/**
 * `?fixture=<kind>` renders from a static snapshot without an engine (review and screenshots).
 * `?fixture=1` (or anything unknown) is the live board.
 */
export const FIXTURE_KINDS = [
  'live', // penalty open + dispute + game markets
  'urgent', // last five seconds of the countdown
  'locked', // penalty locked, waiting for the result
  'result', // penalty resolves: result reveal
  'voided', // penalty voided: refund reveal
  'threeway', // 3-way moment market with long labels
  'edge', // fresh market at the edges: >99% / <1%, 100+ payout, empty pool
  'board', // game-long markets only
  'idle', // live game, nothing open yet
  'host', // live board with the host dock open
  'lobby', // lobby with players
  'lobby-empty', // lobby before anyone joins
  'scorecard', // scorecard view
  'end', // end of game, challenge window
  'final', // end of game, everyone paid
  'connecting', // no snapshot yet
  'reconnecting', // snapshot + reconnecting banner
  'kit', // design kit
] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];
export function fixtureParam(search = window.location.search): FixtureKind | null {
  const v = new URLSearchParams(search).get('fixture');
  if (v === null) return null;
  return (FIXTURE_KINDS as readonly string[]).includes(v) ? (v as FixtureKind) : 'live';
}
