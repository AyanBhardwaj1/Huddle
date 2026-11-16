import type { GameInfo, GeminiContractQuote, GeminiEventQuote, GeminiPanel, GeminiRef, MarketCandidate, Outcome, TeamRef } from '@huddle/shared';
import { quoteFromPrices } from './mid';
import { norm, teamKeys } from './teams';

/**
 * Gemini Prediction Markets payloads, as observed live on 2026-11-16 (see docs/workstreams/A3.md).
 * Lists come wrapped as `{ data: RawEvent[], pagination }`; a single event comes bare.
 * Only the fields we read are typed; everything is optional and parsed defensively.
 */
export interface RawContract {
  id?: string;
  /** Short contract code inside the event: "DAL", "D" (tie), "O53" (over 53.5). */
  ticker?: string;
  label?: string;
  /** e.g. "GEMI-NFL-2611221800-TEN-DAL-M-DAL"; the WebSocket stream name is `{instrumentSymbol}@bookTicker`. */
  instrumentSymbol?: string;
  prices?: { bestBid?: unknown; bestAsk?: unknown; lastTradePrice?: unknown } | null;
  status?: string;
  marketState?: string;
  sportsSide?: string;
}

export interface RawEvent {
  id?: string;
  title?: string;
  slug?: string;
  /** e.g. "NFL-2611221800-TEN-DAL-M": league, YYMMDDHHMM (UTC), away, home, market suffix. */
  ticker?: string;
  status?: string;
  startTime?: string;
  isLive?: boolean;
  participants?: { name?: string; abbreviation?: string; side?: string }[];
  sportsMarket?: { sport?: string; type?: string; subject?: string; metric?: string; scope?: { type?: string; ordinal?: number } };
  contracts?: RawContract[];
}

/** Extra fields we attach to the shared quote type (harmless for consumers that ignore them). */
export interface ContractQuote extends GeminiContractQuote {
  instrumentSymbol?: string;
  /** Totals: the points/goals line, e.g. 53.5. */
  line?: number;
  /** Which side of the game this contract is, when it names a team or a tie. */
  side?: 'home' | 'away' | 'tie';
}

export interface EventQuote extends GeminiEventQuote {
  contracts: ContractQuote[];
  startTime?: string;
  status?: string;
}

export const GEMINI_WEB = 'https://www.gemini.com/predictions';

export function eventUrl(ev: Pick<RawEvent, 'ticker' | 'slug'>): string | undefined {
  if (!ev.ticker || ev.ticker.startsWith('MOCK-')) return undefined;
  return ev.slug ? `${GEMINI_WEB}/${ev.ticker}/${ev.slug}` : `${GEMINI_WEB}/${ev.ticker}`;
}

/** `{ data: [...] }`, a bare array, or a single event -> list of events. Junk -> []. */
export function unwrapEvents(payload: unknown): RawEvent[] {
  const isEvent = (v: unknown): v is RawEvent => !!v && typeof v === 'object' && typeof (v as RawEvent).ticker === 'string';
  if (Array.isArray(payload)) return payload.filter(isEvent);
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data.filter(isEvent);
    if (isEvent(data)) return [data];
    if (isEvent(payload)) return [payload];
  }
  return [];
}

/** Everything in the ticker before the market suffix: "NFL-2611221800-TEN-DAL-M" -> "NFL-2611221800-TEN-DAL". */
export function tickerBase(ticker: string): string {
  const i = ticker.lastIndexOf('-');
  return i > 0 ? ticker.slice(0, i) : ticker;
}

/** Start time from the event, else from the YYMMDDHHMM block in the ticker (UTC). */
export function eventStart(ev: RawEvent): number | undefined {
  if (ev.startTime) {
    const t = Date.parse(ev.startTime);
    if (!Number.isNaN(t)) return t;
  }
  const m = /-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/.exec(ev.ticker ?? '');
  if (!m) return undefined;
  return Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/** What kind of market an event is: `sportsMarket` when present, else the ticker suffix (-M, -1QM, -T, -S, ...). */
export function classifyEvent(ev: RawEvent): { kind: GeminiEventQuote['kind']; period?: string } {
  const sm = ev.sportsMarket;
  const scope = sm?.scope?.type;
  const period = (scope === 'quarter' || scope === 'half') && sm?.scope?.ordinal ? `${sm.scope.ordinal}${scope === 'quarter' ? 'Q' : 'H'}` : undefined;
  if (sm?.type) {
    if (sm.type === 'moneyline') return period ? { kind: 'period_winner', period } : { kind: 'moneyline' };
    if (sm.type === 'total') {
      if (sm.subject && sm.subject !== 'contest') return { kind: 'other' };
      return period ? { kind: 'total', period } : { kind: 'total' };
    }
    if (sm.type === 'spread') return period ? { kind: 'spread', period } : { kind: 'spread' };
    return { kind: 'other' };
  }
  const suffix = (ev.ticker ?? '').split('-').pop() ?? '';
  const m = /^(\d)(Q|H)(M|T|S)$/.exec(suffix);
  if (m) {
    const p = `${m[1]}${m[2]}`;
    return m[3] === 'M' ? { kind: 'period_winner', period: p } : m[3] === 'T' ? { kind: 'total', period: p } : { kind: 'spread', period: p };
  }
  if (suffix === 'M') return { kind: 'moneyline' };
  if (suffix === 'T') return { kind: 'total' };
  if (suffix === 'S') return { kind: 'spread' };
  return { kind: 'other' };
}

/** Does this event belong to the given sport's top league? (Avoids NFL "DAL" matching an NBA or college "DAL".) */
export function eventIsSport(ev: RawEvent, sport: GameInfo['sport']): boolean {
  const ticker = ev.ticker ?? '';
  if (sport === 'nfl') return ticker.startsWith('NFL-');
  const s = ev.sportsMarket?.sport;
  if (s) return s === 'soccer';
  return !/^(NFL|NCAAF|NCAAM|NCAAW|NBA|WNBA|MLB|NHL|UFC|ATP|WTA)-/.test(ticker);
}

export function eventHasTeam(ev: RawEvent, team: TeamRef, sport: GameInfo['sport']): boolean {
  const keys = teamKeys(team, sport);
  for (const p of ev.participants ?? []) {
    if (p.abbreviation && keys.codes.includes(p.abbreviation.toUpperCase())) return true;
    const n = p.name ? norm(p.name) : '';
    if (n && keys.names.some((k) => n === k || n.includes(k) || k.includes(n))) return true;
  }
  const segments = (ev.ticker ?? '').toUpperCase().split('-');
  if (segments.slice(2, -1).some((seg) => keys.codes.includes(seg))) return true;
  const titleTeams = norm((ev.title ?? '').split(':')[0] ?? '').split(' vs ');
  return titleTeams.some((t) => t && keys.names.includes(t));
}

/** Which side of our game a contract refers to. */
export function contractSide(c: RawContract, game: GameInfo): 'home' | 'away' | 'tie' | undefined {
  const label = norm(c.label ?? '');
  const code = (c.ticker ?? '').toUpperCase();
  if (code === 'D' || /\b(tie|draw)\b/.test(label)) return 'tie';
  const hit = (team: TeamRef): boolean => {
    const keys = teamKeys(team, game.sport);
    return keys.codes.includes(code) || keys.names.some((k) => k.length >= 3 && (label === k || label.startsWith(`${k} `) || label.includes(` ${k} `) || label.endsWith(` ${k}`)));
  };
  const h = hit(game.home);
  const a = hit(game.away);
  if (h && !a) return 'home';
  if (a && !h) return 'away';
  if (c.sportsSide === 'home' || c.sportsSide === 'away') return c.sportsSide;
  return undefined;
}

/** "More than 53.5 points scored" -> 53.5 */
export function contractLine(c: RawContract): number | undefined {
  const m = /more than\s+(\d+(?:\.\d+)?)/i.exec(c.label ?? '');
  return m ? Number(m[1]) : undefined;
}

const MAX_CONTRACTS = 12;

/** Raw event -> quote with the mid-price rule applied to every contract. */
export function toEventQuote(ev: RawEvent, game: GameInfo, asOf: string): EventQuote {
  const { kind, period } = classifyEvent(ev);
  const url = eventUrl(ev);
  let contracts: ContractQuote[] = (ev.contracts ?? []).map((c) => {
    const q = quoteFromPrices(c.prices);
    const out: ContractQuote = {
      eventTicker: ev.ticker ?? '',
      contractTicker: c.ticker ?? c.instrumentSymbol ?? '',
      label: c.label ?? c.ticker ?? '',
      prob: q.prob,
      source: q.source,
      asOf,
    };
    if (q.bestBid !== undefined) out.bestBid = q.bestBid;
    if (q.bestAsk !== undefined) out.bestAsk = q.bestAsk;
    if (q.lastTradePrice !== undefined) out.lastTradePrice = q.lastTradePrice;
    if (url) out.url = url;
    if (c.instrumentSymbol) out.instrumentSymbol = c.instrumentSymbol;
    const line = kind === 'total' || kind === 'spread' ? contractLine(c) : undefined;
    if (line !== undefined) out.line = line;
    const side = contractSide(c, game);
    if (side) out.side = side;
    return out;
  });
  if (contracts.length > MAX_CONTRACTS) {
    // Ladders (totals, spreads) list dozens of lines; keep the quoted ones closest to a coin flip.
    contracts = contracts
      .filter((c) => c.prob !== null)
      .sort((a, b) => Math.abs((a.prob ?? 0) - 0.5) - Math.abs((b.prob ?? 0) - 0.5))
      .slice(0, MAX_CONTRACTS)
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }
  const out: EventQuote = { eventTicker: ev.ticker ?? '', title: ev.title ?? ev.ticker ?? '', kind, contracts };
  if (period) out.period = period;
  if (url) out.url = url;
  if (ev.startTime) out.startTime = ev.startTime;
  if (ev.status) out.status = ev.status;
  return out;
}

const KIND_ORDER: Record<GeminiEventQuote['kind'], number> = { moneyline: 0, period_winner: 1, total: 2, spread: 3, other: 4 };

/**
 * Pick the Gemini events for our game out of a pile of search results: same league, both teams,
 * and (when several games match) the one closest to the game's start, else the next one up.
 */
export function selectGameEvents(events: RawEvent[], game: GameInfo, now: number = Date.now()): RawEvent[] {
  const mine = events.filter((ev) => eventIsSport(ev, game.sport) && eventHasTeam(ev, game.home, game.sport) && eventHasTeam(ev, game.away, game.sport));
  if (mine.length === 0) return [];
  const groups = new Map<string, RawEvent[]>();
  for (const ev of mine) {
    const base = tickerBase(ev.ticker ?? '');
    groups.set(base, [...(groups.get(base) ?? []), ev]);
  }
  const target = game.startsAt ? Date.parse(game.startsAt) : Number.NaN;
  const scored = [...groups.entries()].map(([base, evs]) => {
    const start = evs.map(eventStart).find((t) => t !== undefined);
    let score: number;
    if (start === undefined) score = Number.MAX_SAFE_INTEGER / 2;
    else if (!Number.isNaN(target)) score = Math.abs(start - target);
    else score = start >= now - 6 * 3600_000 ? start - now : (now - start) * 1000; // prefer upcoming or in progress
    return { base, evs, score };
  });
  scored.sort((a, b) => a.score - b.score);
  // A real fixture date that is more than 3 days off is a different game between the same teams.
  if (!Number.isNaN(target) && game.status !== 'replay' && scored[0]!.score > 3 * 24 * 3600_000) return [];
  const seen = new Set<string>();
  return scored[0]!.evs.filter((ev) => (seen.has(ev.ticker!) ? false : (seen.add(ev.ticker!), true)));
}

/** Build the "Friends vs. the Pros" panel from the events selected for a game. */
export function buildPanel(selected: RawEvent[], game: GameInfo, source: 'live' | 'mock', asOf: string): GeminiPanel {
  const events = selected
    .map((ev) => toEventQuote(ev, game, asOf))
    .filter((q) => q.kind !== 'other' && q.contracts.length > 0)
    .filter((q) => q.kind !== 'spread' || !q.period)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.period ?? '').localeCompare(b.period ?? ''));
  if (events.length === 0) return noMatchPanel(game, asOf);
  const quoted = events.some((e) => e.contracts.some((c) => c.prob !== null));
  const panel: GeminiPanel = { available: quoted, source, events, asOf };
  if (!quoted) panel.note = `Gemini lists ${game.away.name} vs ${game.home.name} but has no usable prices yet (no bids/asks within 10 cents, no trades). Gemini column hidden.`;
  return panel;
}

export function noMatchPanel(game: GameInfo, asOf: string, why?: string): GeminiPanel {
  return {
    available: false,
    source: 'none',
    events: [],
    asOf,
    note: why ?? `No Gemini market found for ${game.home.name} vs ${game.away.name}. Gemini column hidden for this game.`,
  };
}

/**
 * Map one of our markets to a comparable Gemini contract. Returns the first of our outcomes (in
 * order, or the hinted team first) that has a usable Gemini price. Undefined when not comparable.
 */
export function refFor(panel: GeminiPanel, hint: MarketCandidate['geminiHint'], outcomes: Outcome[], game: GameInfo): GeminiRef | undefined {
  if (!hint || !panel.available) return undefined;
  const events = panel.events as EventQuote[];
  const ev =
    hint.kind === 'moneyline'
      ? events.find((e) => e.kind === 'moneyline' && !e.period)
      : hint.kind === 'period_winner'
        ? events.find((e) => e.kind === 'period_winner' && !!hint.period && e.period?.toUpperCase() === hint.period.toUpperCase())
        : events.find((e) => e.kind === 'total' && (hint.period ? e.period?.toUpperCase() === hint.period.toUpperCase() : !e.period));
  if (!ev) return undefined;

  const make = (c: ContractQuote, outcome: Outcome): GeminiRef => {
    const ref: GeminiRef = { eventTicker: ev.eventTicker, contractTicker: c.contractTicker, prob: c.prob as number, asOf: c.asOf, outcomeId: outcome.id, label: c.label };
    const url = c.url ?? ev.url;
    if (url) ref.url = url;
    return ref;
  };

  if (hint.kind === 'total') {
    if (hint.line === undefined) return undefined;
    const c = ev.contracts.find((x) => x.prob !== null && (x.line ?? lineFromLabel(x.label)) === hint.line);
    const over = outcomes.find((o) => o.id === 'over' || o.id === 'yes') ?? outcomes[0];
    return c && over ? make(c, over) : undefined;
  }

  const sideOfOutcome = (o: Outcome): 'home' | 'away' | 'tie' | undefined => {
    if (o.id === 'home' || o.id === 'away') return o.id;
    if (o.id === 'tie' || o.id === 'draw') return 'tie';
    const l = norm(o.label);
    if (l === norm(game.home.name) || l === norm(game.home.short)) return 'home';
    if (l === norm(game.away.name) || l === norm(game.away.short)) return 'away';
    return undefined;
  };
  const hinted = hint.team ? (hint.team.toUpperCase() === game.home.short.toUpperCase() ? 'home' : hint.team.toUpperCase() === game.away.short.toUpperCase() ? 'away' : undefined) : undefined;
  const ordered = [...outcomes].sort((a, b) => Number(sideOfOutcome(b) === hinted) - Number(sideOfOutcome(a) === hinted));
  for (const o of ordered) {
    const side = sideOfOutcome(o);
    if (!side) continue;
    const c = ev.contracts.find((x) => x.prob !== null && (x.side ?? sideFromQuote(x, game)) === side);
    if (c) return make(c, o);
  }
  return undefined;
}

function lineFromLabel(label: string): number | undefined {
  return contractLine({ label });
}

function sideFromQuote(c: GeminiContractQuote, game: GameInfo): 'home' | 'away' | 'tie' | undefined {
  return contractSide({ label: c.label, ticker: c.contractTicker.split('-').pop() }, game);
}
