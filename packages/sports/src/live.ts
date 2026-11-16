import type { GameEvent, GameEventType, GameFeed, GameInfo, Sport } from '@huddle/shared';

/** A provider event before it gets a `seq` and wall-clock `ts`. `key` is stable across polls. */
export interface KeyedEvent {
  key: string;
  type: GameEventType;
  clock: { period: number; display: string };
  team?: string;
  player?: string;
  data: Record<string, unknown>;
  score: { home: number; away: number };
  text?: string;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** GET JSON with a timeout. Throws on network errors, timeouts and non-2xx. */
export async function getJson(fetchImpl: FetchLike, url: string, timeoutMs: number, headers?: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface PollOptions {
  info: GameInfo;
  sport: Sport;
  intervalMs: number;
  /** Fetch + map the provider's full event list so far. `done` stops the poller after delivery. */
  snapshot(): Promise<{ events: KeyedEvent[]; done: boolean }>;
  onEvent(e: GameEvent): void;
  onError?(err: unknown): void;
}

/**
 * Generic polling feed for live providers: each poll maps the provider's whole event list, and
 * anything with an unseen key is delivered in order with the next `seq`. Whatever already exists on
 * the first poll is history, so it is flagged `data.catchUp = true` (state is rebuilt, but no markets
 * are proposed for moments that have passed).
 */
export function createPollingFeed(opts: PollOptions): GameFeed {
  const seen = new Set<string>();
  let seq = 0;
  let stopped = false;
  let first = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async (): Promise<void> => {
    if (stopped) return;
    let done = false;
    try {
      const snap = await opts.snapshot();
      if (stopped) return;
      for (const k of snap.events) {
        if (seen.has(k.key)) continue;
        seen.add(k.key);
        seq += 1;
        const event: GameEvent = {
          gameId: opts.info.id,
          sport: opts.sport,
          seq,
          ts: new Date().toISOString(),
          clock: k.clock,
          type: k.type,
          data: first ? { ...k.data, catchUp: true } : k.data,
          score: k.score,
        };
        if (k.team) event.team = k.team;
        if (k.player) event.player = k.player;
        if (k.text) event.text = k.text;
        try {
          opts.onEvent(event);
        } catch (err) {
          console.error('[sports] live listener threw', err);
        }
      }
      done = snap.done;
      first = false;
    } catch (err) {
      opts.onError?.(err);
    }
    if (!stopped && !done) timer = setTimeout(() => void poll(), opts.intervalMs);
  };

  void poll();

  return {
    info: opts.info,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// ───────────────────────── tiny defensive accessors ─────────────────────────

export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : undefined;
}

export function numOr(v: unknown, fallback: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function numMaybe(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}
