import type { GameInfo, GeminiClient, GeminiPanel, GeminiRef, MarketCandidate, Outcome } from '@huddle/shared';
import { LiveGeminiClient, type GeminiOptions } from './client';
import { noMatchPanel, refFor } from './mapping';
import { OfflineGeminiClient } from './mock';

export type Env = Record<string, string | undefined>;

/** Overall budget for a match, so a slow Gemini never holds up party creation. */
export const MATCH_DEADLINE_MS = 6000;

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Live Gemini with an automatic fallback: if the API is unreachable the panel comes from the
 * offline sample (clearly flagged `source: 'mock'` with a note), or is hidden when
 * `fallback` is 'none'. "No matching market" is never papered over: that returns
 * `available: false` with a note for the host screen.
 */
export class FallbackGeminiClient implements GeminiClient {
  readonly source = 'live' as const;

  constructor(
    private readonly live: LiveGeminiClient,
    private readonly offline: OfflineGeminiClient,
    private readonly fallback: 'mock' | 'none' = 'mock',
    private readonly deadlineMs: number = MATCH_DEADLINE_MS,
  ) {}

  async matchGame(game: GameInfo): Promise<GeminiPanel> {
    try {
      return await withDeadline(this.live.matchGame(game), this.deadlineMs, 'Gemini match');
    } catch (err) {
      const why = (err as Error).message;
      if (this.fallback === 'mock') return this.offline.matchGame(game, `${why}. Showing offline SAMPLE odds, not live Gemini prices.`);
      return noMatchPanel(game, new Date().toISOString(), `${why}. Gemini column hidden.`);
    }
  }

  async refresh(panel: GeminiPanel): Promise<GeminiPanel> {
    if (panel.source === 'mock') return this.offline.refresh(panel);
    if (panel.source !== 'live') return panel;
    try {
      return await withDeadline(this.live.refresh(panel), this.deadlineMs, 'Gemini refresh');
    } catch (err) {
      // Keep the last good prices and their original "as of" time; say that they are stale.
      return { ...panel, note: `Gemini refresh failed (${(err as Error).message}); prices are as of ${panel.asOf ?? 'the last update'}.` };
    }
  }

  refFor(panel: GeminiPanel, hint: MarketCandidate['geminiHint'], outcomes: Outcome[], game: GameInfo): GeminiRef | undefined {
    return refFor(panel, hint, outcomes, game);
  }
}

/**
 * Gemini Prediction Markets client (PRD section 11). Public reads, no API key.
 *
 * Env: GEMINI_API_BASE (default https://api.gemini.com), GEMINI_MOCK=1 (force the offline sample),
 * GEMINI_FALLBACK=none (hide the column instead of showing sample odds when Gemini is unreachable),
 * GEMINI_EVENT_TICKERS (comma list: pin events instead of searching), GEMINI_TIMEOUT_MS, GEMINI_CACHE_MS.
 */
export function createGeminiClient(env: Env = process.env): GeminiClient {
  const offline = new OfflineGeminiClient();
  const mock = (env.GEMINI_MOCK ?? '').trim().toLowerCase();
  if (mock === '1' || mock === 'true' || mock === 'yes') return offline;
  const opts: GeminiOptions = {};
  if (env.GEMINI_API_BASE) opts.base = env.GEMINI_API_BASE;
  const timeout = Number(env.GEMINI_TIMEOUT_MS);
  if (Number.isFinite(timeout) && timeout > 0) opts.timeoutMs = timeout;
  const cache = Number(env.GEMINI_CACHE_MS);
  if (env.GEMINI_CACHE_MS && Number.isFinite(cache) && cache >= 0) opts.cacheMs = cache;
  const pinned = (env.GEMINI_EVENT_TICKERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (pinned.length > 0) opts.pinnedTickers = pinned;
  const fallback = (env.GEMINI_FALLBACK ?? '').trim().toLowerCase() === 'none' ? 'none' : 'mock';
  return new FallbackGeminiClient(new LiveGeminiClient(opts), offline, fallback);
}

export { GeminiApi, LiveGeminiClient, GeminiHttpError, GEMINI_API_BASE, DEFAULT_TIMEOUT_MS, DEFAULT_CACHE_MS, type GeminiOptions, type FetchLike } from './client';
export { OfflineGeminiClient, mockEvents, MOCK_NOTE } from './mock';
export { quoteFromPrices, parsePrice, MAX_SPREAD, type Quote, type RawPrices } from './mid';
export {
  buildPanel,
  classifyEvent,
  contractLine,
  contractSide,
  eventHasTeam,
  eventIsSport,
  eventStart,
  eventUrl,
  noMatchPanel,
  refFor,
  selectGameEvents,
  tickerBase,
  toEventQuote,
  unwrapEvents,
  type ContractQuote,
  type EventQuote,
  type RawContract,
  type RawEvent,
} from './mapping';
export { NFL_TEAMS, findNflTeam, geminiTitleName, type NflTeam } from './teams';
export { findGeminiMarkets, formatMarkets, type FoundGame } from './demo';
