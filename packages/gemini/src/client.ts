import type { GameInfo, GeminiClient, GeminiPanel, GeminiRef, MarketCandidate, Outcome } from '@huddle/shared';
import { buildPanel, noMatchPanel, refFor, selectGameEvents, tickerBase, unwrapEvents, type RawEvent } from './mapping';
import { geminiTitleName } from './teams';

export const GEMINI_API_BASE = 'https://api.gemini.com';
export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_CACHE_MS = 10_000;

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GeminiOptions {
  base?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  cacheMs?: number;
  now?: () => number;
  /** Pin specific event tickers instead of searching (comma list in `GEMINI_EVENT_TICKERS`). */
  pinnedTickers?: string[];
}

export class GeminiHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Public, key-less reads of Gemini Prediction Markets (PRD section 11):
 *   GET {base}/v1/prediction-markets/events?status=active&category=sports&search=<text>&limit=50
 *   GET {base}/v1/prediction-markets/events/{eventTicker}
 * Every request has a 3 s timeout and a short cache, so the game loop never waits on Gemini.
 */
export class GeminiApi {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly cacheMs: number;
  private readonly now: () => number;
  private cache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(opts: GeminiOptions = {}) {
    this.base = (opts.base || GEMINI_API_BASE).replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheMs = opts.cacheMs ?? DEFAULT_CACHE_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  private async get(path: string, fresh = false): Promise<unknown> {
    const url = `${this.base}${path}`;
    const hit = this.cache.get(url);
    if (!fresh && hit && this.now() - hit.at < this.cacheMs) return hit.value;
    const value = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        if (!res.ok) throw new GeminiHttpError(`Gemini HTTP ${res.status}`, res.status);
        return await res.json();
      } catch (err) {
        if (err instanceof GeminiHttpError) throw err;
        throw new GeminiHttpError(ctrl.signal.aborted ? `Gemini timed out after ${this.timeoutMs} ms` : `Gemini unreachable: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    })();
    this.cache.set(url, { at: this.now(), value });
    // Failed requests are not cached.
    value.catch(() => {
      if (this.cache.get(url)?.value === value) this.cache.delete(url);
    });
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }

  /** Active sports events matching a search string (matches titles and tickers). */
  async searchEvents(search: string, opts: { status?: string; limit?: number; fresh?: boolean } = {}): Promise<RawEvent[]> {
    const q = new URLSearchParams({ status: opts.status ?? 'active', category: 'sports', search, limit: String(opts.limit ?? 50) });
    return unwrapEvents(await this.get(`/v1/prediction-markets/events?${q.toString()}`, opts.fresh));
  }

  /** One event by ticker. Undefined when Gemini says 404. */
  async getEvent(eventTicker: string, fresh = false): Promise<RawEvent | undefined> {
    try {
      return unwrapEvents(await this.get(`/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`, fresh))[0];
    } catch (err) {
      if (err instanceof GeminiHttpError && err.status === 404) return undefined;
      throw err;
    }
  }
}

/** Live Gemini client. Network errors throw; `createGeminiClient` wraps this with the fallback. */
export class LiveGeminiClient implements GeminiClient {
  readonly source = 'live' as const;
  readonly api: GeminiApi;
  private readonly now: () => number;
  private readonly pinned: string[];
  /** Games we have matched, by ticker base, so `refresh(panel)` can map contracts back to sides. */
  private readonly games = new Map<string, GameInfo>();

  constructor(opts: GeminiOptions = {}) {
    this.api = new GeminiApi(opts);
    this.now = opts.now ?? (() => Date.now());
    this.pinned = opts.pinnedTickers ?? [];
  }

  /** Raw Gemini events for a game: one title search when we know Gemini's names, else by team. */
  async findEvents(game: GameInfo): Promise<RawEvent[]> {
    if (this.pinned.length > 0) {
      const pinned = (await Promise.all(this.pinned.map((t) => this.api.getEvent(t)))).filter((e): e is RawEvent => !!e);
      if (pinned.length > 0) return pinned;
    }
    const home = geminiTitleName(game.home, game.sport);
    const away = geminiTitleName(game.away, game.sport);
    const tried = new Set<string>();
    const search = async (term: string): Promise<RawEvent[]> => {
      if (tried.has(term)) return [];
      tried.add(term);
      return selectGameEvents(await this.api.searchEvents(term), game, this.now());
    };

    // Gemini titles read "Away vs Home"; try both orders, then each team on its own.
    let found = await search(`${away} vs ${home}`);
    if (found.length === 0) found = await search(`${home} vs ${away}`);
    if (found.length === 0) {
      const [a, b] = await Promise.all([search(home), search(away)]);
      found = a.length > 0 ? a : b;
      // A single-team search can miss sibling markets; one more search by ticker prefix gets them all.
      if (found.length > 0 && found[0]!.ticker) {
        const siblings = await search(tickerBase(found[0]!.ticker));
        if (siblings.length >= found.length) found = siblings;
      }
    }
    return found;
  }

  async matchGame(game: GameInfo): Promise<GeminiPanel> {
    const asOf = new Date(this.now()).toISOString();
    const events = await this.findEvents(game);
    if (events.length === 0) return noMatchPanel(game, asOf);
    if (events[0]!.ticker) this.games.set(tickerBase(events[0]!.ticker), game);
    return buildPanel(events, game, 'live', asOf);
  }

  async refresh(panel: GeminiPanel, game?: GameInfo): Promise<GeminiPanel> {
    if (panel.source !== 'live' || panel.events.length === 0) return panel;
    const asOf = new Date(this.now()).toISOString();
    const tickers = panel.events.map((e) => e.eventTicker);
    const want = new Set(tickers);
    const pseudo = game ?? this.games.get(tickerBase(tickers[0]!)) ?? gameFromPanel(panel);
    // One search by ticker prefix returns every sibling market; fall back to one GET per event.
    let raw: RawEvent[] = [];
    try {
      raw = (await this.api.searchEvents(tickerBase(tickers[0]!), { fresh: true })).filter((e) => e.ticker && want.has(e.ticker));
    } catch {
      raw = [];
    }
    const missing = tickers.filter((t) => !raw.some((e) => e.ticker === t));
    if (missing.length > 0) {
      const fetched = await Promise.all(missing.map((t) => this.api.getEvent(t, true)));
      raw = [...raw, ...fetched.filter((e): e is RawEvent => !!e)];
    }
    if (raw.length === 0) return { ...panel, note: 'Gemini no longer lists these markets; showing the last prices seen.' };
    const next = buildPanel(raw, pseudo, 'live', asOf);
    return next.source === 'none' ? { ...panel, note: next.note } : next;
  }

  refFor(panel: GeminiPanel, hint: MarketCandidate['geminiHint'], outcomes: Outcome[], game: GameInfo): GeminiRef | undefined {
    return refFor(panel, hint, outcomes, game);
  }
}

/** `refresh(panel)` has no game; the contracts already carry their side, so a stub is enough. */
function gameFromPanel(panel: GeminiPanel): GameInfo {
  const first = panel.events[0];
  const [away, home] = (first?.title ?? '').split(':')[0]!.split(' vs ').map((s) => s.trim());
  const seg = (first?.eventTicker ?? '').split('-');
  return {
    id: 'gemini-refresh',
    sport: first?.eventTicker.startsWith('NFL-') ? 'nfl' : 'soccer',
    title: first?.title ?? '',
    home: { name: home || 'Home', short: seg[seg.length - 2] ?? 'HOME' },
    away: { name: away || 'Away', short: seg[seg.length - 3] ?? 'AWAY' },
    status: 'live',
    source: 'mock',
  };
}
