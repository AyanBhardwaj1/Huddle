import { describe, expect, it } from 'vitest';
import type { GameInfo, Outcome } from '@huddle/shared';
import settled from './__fixtures__/event-settled-sf-dal-m.json';
import single from './__fixtures__/event-ten-dal-m.json';
import dallasSearch from './__fixtures__/events-search-dallas.json';
import lacBalSearch from './__fixtures__/events-search-lac-bal.json';
import {
  buildPanel,
  classifyEvent,
  createGeminiClient,
  eventStart,
  FallbackGeminiClient,
  findGeminiMarkets,
  findNflTeam,
  formatMarkets,
  GeminiApi,
  GeminiHttpError,
  LiveGeminiClient,
  OfflineGeminiClient,
  quoteFromPrices,
  refFor,
  selectGameEvents,
  tickerBase,
  unwrapEvents,
  type ContractQuote,
  type EventQuote,
  type FetchLike,
  type RawEvent,
} from './index';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const AS_OF = '2026-11-16T12:00:00.000Z';

const tenDal: GameInfo = {
  id: 'replay-ten-dal',
  sport: 'nfl',
  title: 'Tennessee Titans at Dallas Cowboys',
  home: { name: 'Dallas Cowboys', short: 'DAL' },
  away: { name: 'Tennessee Titans', short: 'TEN' },
  status: 'replay',
  source: 'replay',
};
const lacBal: GameInfo = {
  id: 'espn:nfl:401873065',
  sport: 'nfl',
  title: 'Los Angeles Chargers at Baltimore Ravens',
  home: { name: 'Baltimore Ravens', short: 'BAL' },
  away: { name: 'Los Angeles Chargers', short: 'LAC' },
  startsAt: '2026-11-17T01:15:00.000Z',
  status: 'scheduled',
  source: 'espn',
};
const porEsp: GameInfo = {
  id: 'replay-por-esp',
  sport: 'soccer',
  title: 'Portugal vs Spain',
  home: { name: 'Portugal', short: 'POR' },
  away: { name: 'Spain', short: 'ESP' },
  status: 'replay',
  source: 'replay',
};

const WINNER: Outcome[] = [
  { id: 'home', label: 'Cowboys' },
  { id: 'away', label: 'Titans' },
];
const THREE_WAY: Outcome[] = [
  { id: 'home', label: 'Ravens' },
  { id: 'tie', label: 'Tie' },
  { id: 'away', label: 'Chargers' },
];
const OVER_UNDER: Outcome[] = [
  { id: 'over', label: 'Over 53.5' },
  { id: 'under', label: 'Under 53.5' },
];

/** Fake Gemini: answers searches from a table keyed by the `search` parameter, and single events by ticker. */
function fakeGemini(routes: { search?: Record<string, unknown>; events?: Record<string, unknown>; fallback?: unknown }, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    const search = u.searchParams.get('search');
    if (search !== null) {
      const body = routes.search?.[search] ?? routes.fallback ?? { data: [], pagination: { limit: 50, offset: 0, total: 0 } };
      return { ok: true, status: 200, json: async () => body };
    }
    const ticker = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    const ev = routes.events?.[ticker];
    if (!ev) return { ok: false, status: 404, json: async () => ({ error: 'Event not found' }) };
    return { ok: true, status: 200, json: async () => ev };
  };
}

function quote(panelEvents: unknown[], ticker: string, contract: string): ContractQuote {
  const ev = (panelEvents as EventQuote[]).find((e) => e.eventTicker === ticker)!;
  return ev.contracts.find((c) => c.contractTicker === contract)!;
}

describe('mid-price rule (PRD section 11)', () => {
  it('uses the mid when both sides are there and the spread is at most 0.10', () => {
    expect(quoteFromPrices({ bestBid: '0.79', bestAsk: '0.8', lastTradePrice: '0.5' })).toEqual({ prob: 0.795, source: 'mid', bestBid: 0.79, bestAsk: 0.8, lastTradePrice: 0.5 });
    expect(quoteFromPrices({ bestBid: '0.46', bestAsk: '0.54' })).toMatchObject({ prob: 0.5, source: 'mid' });
    // Exactly 0.10 wide is still a mid.
    expect(quoteFromPrices({ bestBid: '0.40', bestAsk: '0.50' })).toMatchObject({ prob: 0.45, source: 'mid' });
  });

  it('falls back to the last trade when the spread is wider than 0.10', () => {
    expect(quoteFromPrices({ bestBid: '0.40', bestAsk: '0.51', lastTradePrice: '0.47' })).toMatchObject({ prob: 0.47, source: 'last' });
    expect(quoteFromPrices({ bestBid: '0.13', bestAsk: '0.54', lastTradePrice: '0.2' })).toMatchObject({ prob: 0.2, source: 'last' });
  });

  it('falls back to the last trade when a side is missing or the book is crossed', () => {
    expect(quoteFromPrices({ bestAsk: '0.42', lastTradePrice: '0.42' })).toMatchObject({ prob: 0.42, source: 'last' });
    expect(quoteFromPrices({ bestBid: '0.01', lastTradePrice: '0.01' })).toMatchObject({ prob: 0.01, source: 'last' });
    expect(quoteFromPrices({ bestBid: '0.6', bestAsk: '0.5', lastTradePrice: '0.55' })).toMatchObject({ prob: 0.55, source: 'last' });
  });

  it('is unavailable (prob null) rather than a misleading number', () => {
    expect(quoteFromPrices({ bestAsk: '0.99' })).toEqual({ prob: null, source: 'unavailable', bestAsk: 0.99 });
    expect(quoteFromPrices({ bestBid: '0.49', bestAsk: '0.6' })).toMatchObject({ prob: null, source: 'unavailable' });
    expect(quoteFromPrices({})).toEqual({ prob: null, source: 'unavailable' });
    expect(quoteFromPrices(null)).toEqual({ prob: null, source: 'unavailable' });
    expect(quoteFromPrices({ bestBid: 'abc', bestAsk: '1.7', lastTradePrice: '-0.2' })).toEqual({ prob: null, source: 'unavailable' });
  });
});

describe('recorded Gemini payloads', () => {
  const dallas = unwrapEvents(dallasSearch);
  const lac = unwrapEvents(lacBalSearch);

  it('unwraps list, single-event and junk payloads', () => {
    expect(dallas).toHaveLength(12);
    expect(unwrapEvents(single).map((e) => e.ticker)).toEqual(['NFL-2611221800-TEN-DAL-M']);
    expect(unwrapEvents({ error: 'Event not found' })).toEqual([]);
    expect(unwrapEvents(null)).toEqual([]);
    expect(unwrapEvents({ data: [1, null, { title: 'no ticker' }] })).toEqual([]);
  });

  it('classifies events from sportsMarket and, without it, from the ticker suffix', () => {
    const kinds = (evs: RawEvent[]): Record<string, string> => Object.fromEntries(evs.map((e) => [e.ticker!.split('-').pop()!, [classifyEvent(e).kind, classifyEvent(e).period].filter(Boolean).join(' ')]));
    const expected = { M: 'moneyline', T: 'total', S: 'spread', '1QM': 'period_winner 1Q', '2QM': 'period_winner 2Q', '1HM': 'period_winner 1H', '2HM': 'period_winner 2H', '1QT': 'total 1Q', TT: 'other' };
    expect(kinds(lac)).toEqual(expected);
    const bare = lac.map((e) => ({ ...e, sportsMarket: undefined }));
    expect(kinds(bare)).toEqual(expected);
    expect(classifyEvent({ ticker: 'NFLDALWINS26' }).kind).toBe('other');
    expect(classifyEvent({ ticker: 'NFL-2611151800-MIN-GB-PPTD', sportsMarket: { type: 'prop' } }).kind).toBe('other');
  });

  it('reads the start time from the event or the ticker', () => {
    expect(eventStart({ ticker: 'NFL-2611221800-TEN-DAL-M' })).toBe(Date.parse('2026-11-22T18:00:00Z'));
    expect(eventStart({ ticker: 'X', startTime: '2026-11-17T01:15:00.000Z' })).toBe(Date.parse('2026-11-17T01:15:00Z'));
    expect(eventStart({ ticker: 'NFLDALWINS26' })).toBeUndefined();
    expect(tickerBase('NFL-2611221800-TEN-DAL-1QM')).toBe('NFL-2611221800-TEN-DAL');
  });

  it('matches a game by league and both teams, ignoring college and futures noise', () => {
    const picked = selectGameEvents(dallas, tenDal, NOW);
    expect(picked).toHaveLength(9);
    expect(picked.every((e) => e.ticker!.startsWith('NFL-2611221800-TEN-DAL-'))).toBe(true);
    // Works from short codes alone, and from Gemini-style city names.
    expect(selectGameEvents(dallas, { ...tenDal, home: { name: 'DAL', short: 'DAL' }, away: { name: 'TEN', short: 'TEN' } }, NOW)).toHaveLength(9);
    expect(selectGameEvents(dallas, { ...tenDal, home: { name: 'Dallas', short: 'DLS' }, away: { name: 'Tennessee', short: 'TNS' } }, NOW)).toHaveLength(9);
    // Dallas is there but the opponent is not: no match (never a different game's odds).
    expect(selectGameEvents(dallas, { ...tenDal, away: { name: 'San Francisco 49ers', short: 'SF' } }, NOW)).toEqual([]);
    expect(selectGameEvents(dallas, porEsp, NOW)).toEqual([]);
    expect(selectGameEvents(lac, lacBal, NOW)).toHaveLength(9);
    // A scheduled fixture a month away from Gemini's game is a different game.
    expect(selectGameEvents(lac, { ...lacBal, startsAt: '2026-12-20T18:00:00.000Z' }, NOW)).toEqual([]);
  });

  it('prefers the game closest to the fixture date, else the next one up', () => {
    const later = dallas.filter((e) => e.ticker!.startsWith('NFL-2611221800')).map((e) => ({ ...e, ticker: e.ticker!.replace('2611221800', '2612271800'), startTime: '2026-12-27T18:00:00.000Z' }));
    const both = [...later, ...dallas];
    expect(selectGameEvents(both, tenDal, NOW)[0]!.ticker).toContain('2611221800');
    expect(selectGameEvents(both, { ...tenDal, startsAt: '2026-12-27T18:00:00.000Z' }, NOW)[0]!.ticker).toContain('2612271800');
    expect(selectGameEvents(both, tenDal, Date.parse('2026-12-01T00:00:00Z'))[0]!.ticker).toContain('2612271800');
  });

  it('builds the panel with mids, sides, lines and links', () => {
    const panel = buildPanel(selectGameEvents(dallas, tenDal, NOW), tenDal, 'live', AS_OF);
    expect(panel).toMatchObject({ available: true, source: 'live', asOf: AS_OF });
    expect(panel.note).toBeUndefined();
    expect(panel.events.map((e) => `${e.kind}${e.period ? ':' + e.period : ''}`)).toEqual(['moneyline', 'period_winner:1H', 'period_winner:1Q', 'period_winner:2H', 'period_winner:2Q', 'period_winner:3Q', 'period_winner:4Q', 'total', 'spread']);

    const dal = quote(panel.events, 'NFL-2611221800-TEN-DAL-M', 'DAL');
    expect(dal).toMatchObject({ label: 'Dallas', prob: 0.795, source: 'mid', bestBid: 0.79, bestAsk: 0.8, lastTradePrice: 0.79, side: 'home', asOf: AS_OF, instrumentSymbol: 'GEMI-NFL-2611221800-TEN-DAL-M-DAL' });
    expect(dal.url).toBe('https://www.gemini.com/predictions/NFL-2611221800-TEN-DAL-M/tennessee-vs-dallas');
    expect(quote(panel.events, 'NFL-2611221800-TEN-DAL-M', 'TEN')).toMatchObject({ prob: 0.205, source: 'mid', side: 'away' });
    expect(quote(panel.events, 'NFL-2611221800-TEN-DAL-T', 'O53')).toMatchObject({ prob: 0.5, source: 'mid', line: 53.5 });
    // Quarter markets are listed but have no book yet: unavailable, not a made-up number.
    expect(quote(panel.events, 'NFL-2611221800-TEN-DAL-1QM', 'DAL')).toMatchObject({ prob: null, source: 'unavailable', side: 'home' });
    expect(quote(panel.events, 'NFL-2611221800-TEN-DAL-1QM', 'D')).toMatchObject({ prob: null, side: 'tie' });
  });

  it('applies the wide-spread rule on real quarter and half books', () => {
    const panel = buildPanel(selectGameEvents(lac, lacBal, NOW), lacBal, 'live', AS_OF);
    expect(quote(panel.events, 'NFL-2611170115-LAC-BAL-M', 'BAL')).toMatchObject({ prob: 0.675, side: 'home' });
    expect(quote(panel.events, 'NFL-2611170115-LAC-BAL-1QM', 'BAL')).toMatchObject({ prob: 0.455, source: 'mid' });
    expect(quote(panel.events, 'NFL-2611170115-LAC-BAL-1QM', 'D')).toMatchObject({ prob: 0.23, side: 'tie' });
    // 0.49 / 0.60 is 11 cents wide with no last trade.
    expect(quote(panel.events, 'NFL-2611170115-LAC-BAL-2HM', 'BAL')).toMatchObject({ prob: null, source: 'unavailable', bestBid: 0.49, bestAsk: 0.6 });
    expect(quote(panel.events, 'NFL-2611170115-LAC-BAL-2HM', 'LAC')).toMatchObject({ prob: 0.325, source: 'mid' });
    // Team totals are not comparable to anything we ask, and period spreads are noise.
    expect(panel.events.some((e) => e.eventTicker.endsWith('-TT'))).toBe(false);
  });

  it('hides the column for a settled event with no prices, and says why', () => {
    const sfDal: GameInfo = { ...tenDal, away: { name: 'San Francisco 49ers', short: 'SF' } };
    const panel = buildPanel(unwrapEvents(settled), sfDal, 'live', AS_OF);
    expect(panel.available).toBe(false);
    expect(panel.note).toMatch(/no usable prices/);
    expect(refFor(panel, { kind: 'moneyline' }, WINNER, sfDal)).toBeUndefined();
  });

  it('refFor maps a Gemini contract onto one of our outcomes', () => {
    const panel = buildPanel(selectGameEvents(dallas, tenDal, NOW), tenDal, 'live', AS_OF);
    expect(refFor(panel, { kind: 'moneyline' }, WINNER, tenDal)).toEqual({
      eventTicker: 'NFL-2611221800-TEN-DAL-M',
      contractTicker: 'DAL',
      prob: 0.795,
      asOf: AS_OF,
      outcomeId: 'home',
      label: 'Dallas',
      url: 'https://www.gemini.com/predictions/NFL-2611221800-TEN-DAL-M/tennessee-vs-dallas',
    });
    expect(refFor(panel, { kind: 'moneyline', team: 'TEN' }, WINNER, tenDal)).toMatchObject({ contractTicker: 'TEN', prob: 0.205, outcomeId: 'away' });
    // Outcomes identified by label rather than id.
    expect(refFor(panel, { kind: 'moneyline' }, [{ id: 'a', label: 'Tennessee Titans' }, { id: 'b', label: 'Dallas Cowboys' }], tenDal)).toMatchObject({ outcomeId: 'a', prob: 0.205 });
    expect(refFor(panel, { kind: 'total', line: 53.5 }, OVER_UNDER, tenDal)).toMatchObject({ contractTicker: 'O53', prob: 0.5, outcomeId: 'over' });
    // A different line is a different bet.
    expect(refFor(panel, { kind: 'total', line: 44.5 }, OVER_UNDER, tenDal)).toBeUndefined();
    // No book on the quarter yet.
    expect(refFor(panel, { kind: 'period_winner', period: '1Q' }, THREE_WAY, tenDal)).toBeUndefined();
    expect(refFor(panel, undefined, WINNER, tenDal)).toBeUndefined();
    expect(refFor({ ...panel, available: false }, { kind: 'moneyline' }, WINNER, tenDal)).toBeUndefined();

    const lacPanel = buildPanel(selectGameEvents(lac, lacBal, NOW), lacBal, 'live', AS_OF);
    expect(refFor(lacPanel, { kind: 'period_winner', period: '1Q' }, THREE_WAY, lacBal)).toMatchObject({ eventTicker: 'NFL-2611170115-LAC-BAL-1QM', contractTicker: 'BAL', prob: 0.455, outcomeId: 'home' });
    // Home is unavailable in the 2nd half (wide spread), so the next comparable outcome is used.
    expect(refFor(lacPanel, { kind: 'period_winner', period: '2H' }, THREE_WAY, lacBal)).toMatchObject({ contractTicker: 'LAC', prob: 0.325, outcomeId: 'away' });
    expect(refFor(lacPanel, { kind: 'period_winner', period: '1h' }, [{ id: 'tie', label: 'Tie' }], lacBal)).toMatchObject({ contractTicker: 'D', prob: 0.09, outcomeId: 'tie' });
    expect(refFor(lacPanel, { kind: 'period_winner', period: '3Q' }, THREE_WAY, lacBal)).toBeUndefined();
  });
});

describe('live client (fake fetch)', () => {
  it('finds the game with one title search and caches it', async () => {
    const calls: string[] = [];
    let now = NOW;
    const client = new LiveGeminiClient({ fetch: fakeGemini({ search: { 'Tennessee vs Dallas': dallasSearch } }, calls), now: () => now });
    const panel = await client.matchGame(tenDal);
    expect(client.source).toBe('live');
    expect(panel).toMatchObject({ available: true, source: 'live', asOf: AS_OF });
    expect(panel.events).toHaveLength(9);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!);
    expect(u.origin + u.pathname).toBe('https://api.gemini.com/v1/prediction-markets/events');
    expect(Object.fromEntries(u.searchParams)).toEqual({ status: 'active', category: 'sports', search: 'Tennessee vs Dallas', limit: '50' });

    await client.matchGame(tenDal);
    expect(calls).toHaveLength(1); // served from the 10 s cache
    now += 11_000;
    await client.matchGame(tenDal);
    expect(calls).toHaveLength(2);
  });

  it('falls back to single-team searches, then pulls sibling markets by ticker prefix', async () => {
    const calls: string[] = [];
    const onlyMoneyline = { data: unwrapEvents(dallasSearch).filter((e) => !e.ticker!.startsWith('NFL-') || e.ticker!.endsWith('-M')) };
    const client = new LiveGeminiClient({ fetch: fakeGemini({ search: { Dallas: onlyMoneyline, 'NFL-2611221800-TEN-DAL': dallasSearch } }, calls), now: () => NOW });
    const panel = await client.matchGame(tenDal);
    expect(calls.map((c) => new URL(c).searchParams.get('search'))).toEqual(['Tennessee vs Dallas', 'Dallas vs Tennessee', 'Dallas', 'Tennessee', 'NFL-2611221800-TEN-DAL']);
    expect(panel.events).toHaveLength(9);
  });

  it('says so when Gemini has no market for the game', async () => {
    const client = new LiveGeminiClient({ fetch: fakeGemini({}), now: () => NOW });
    const panel = await client.matchGame(porEsp);
    expect(panel).toMatchObject({ available: false, source: 'none', events: [] });
    expect(panel.note).toBe('No Gemini market found for Portugal vs Spain. Gemini column hidden for this game.');
    expect(client.refFor(panel, { kind: 'moneyline' }, WINNER, porEsp)).toBeUndefined();
  });

  it('refresh re-reads the matched events and picks up new prices', async () => {
    let body: unknown = dallasSearch;
    let now = NOW;
    const calls: string[] = [];
    const base = fakeGemini({}, calls);
    const client = new LiveGeminiClient({
      fetch: async (url, init) => (new URL(url).searchParams.get('search') !== null ? { ok: true, status: 200, json: async () => body } : base(url, init)),
      now: () => now,
    });
    const panel = await client.matchGame(tenDal);
    const moved = JSON.parse(JSON.stringify(dallasSearch)) as { data: RawEvent[] };
    const ml = moved.data.find((e) => e.ticker === 'NFL-2611221800-TEN-DAL-M')!;
    ml.contracts![0]!.prices = { bestBid: '0.83', bestAsk: '0.85', lastTradePrice: '0.84' };
    body = moved;
    now += 1000; // still inside the cache window: refresh must bypass the cache
    const next = await client.refresh(panel);
    expect(next.asOf).toBe('2026-11-16T12:00:01.000Z');
    expect(next.events.map((e) => e.eventTicker).sort()).toEqual(panel.events.map((e) => e.eventTicker).sort());
    expect(quote(next.events, 'NFL-2611221800-TEN-DAL-M', 'DAL')).toMatchObject({ prob: 0.84, side: 'home' });
    expect(client.refFor(next, { kind: 'moneyline' }, WINNER, tenDal)).toMatchObject({ prob: 0.84, outcomeId: 'home' });
    // Nothing to refresh on an empty or non-live panel.
    const none = await client.matchGame(porEsp).catch(() => undefined);
    expect(none && (await client.refresh(none))).toBe(none);
  });

  it('pinned tickers skip the search', async () => {
    const calls: string[] = [];
    const client = new LiveGeminiClient({ fetch: fakeGemini({ events: { 'NFL-2611221800-TEN-DAL-M': single } }, calls), now: () => NOW, pinnedTickers: ['NFL-2611221800-TEN-DAL-M'] });
    const panel = await client.matchGame(tenDal);
    expect(panel.events.map((e) => e.eventTicker)).toEqual(['NFL-2611221800-TEN-DAL-M']);
    expect(calls).toEqual(['https://api.gemini.com/v1/prediction-markets/events/NFL-2611221800-TEN-DAL-M']);
  });

  it('times out, reports HTTP errors and does not cache failures', async () => {
    const hang: FetchLike = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const slow = new GeminiApi({ fetch: hang, timeoutMs: 20 });
    await expect(slow.searchEvents('Dallas')).rejects.toThrow(/timed out after 20 ms/);

    let n = 0;
    const flaky = new GeminiApi({
      fetch: async () => {
        n += 1;
        return n === 1 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => dallasSearch };
      },
    });
    await expect(flaky.searchEvents('Dallas')).rejects.toBeInstanceOf(GeminiHttpError);
    expect(await flaky.searchEvents('Dallas')).toHaveLength(12);
    expect(n).toBe(2);
    const api = new GeminiApi({ fetch: fakeGemini({ events: { 'NFL-2611221800-TEN-DAL-M': single } }), base: 'https://example.test/' });
    expect((await api.getEvent('NFL-2611221800-TEN-DAL-M'))?.title).toBe('Tennessee vs Dallas');
    expect(await api.getEvent('NOPE')).toBeUndefined();
  });
});

describe('fallback, mock and factory', () => {
  const down: FetchLike = async () => {
    throw new Error('getaddrinfo ENOTFOUND api.gemini.com');
  };

  it('falls back to clearly flagged sample odds when Gemini is unreachable', async () => {
    const client = new FallbackGeminiClient(new LiveGeminiClient({ fetch: down }), new OfflineGeminiClient(() => NOW));
    expect(client.source).toBe('live');
    const panel = await client.matchGame(tenDal);
    expect(panel).toMatchObject({ available: true, source: 'mock', asOf: AS_OF });
    expect(panel.note).toMatch(/Gemini unreachable.*SAMPLE odds, not live Gemini prices/);
    expect(panel.events.every((e) => e.eventTicker.startsWith('MOCK-'))).toBe(true);
    expect(panel.events.every((e) => e.url === undefined)).toBe(true);
    expect((await client.refresh(panel)).source).toBe('mock');
  });

  it('GEMINI_FALLBACK=none hides the column instead', async () => {
    const client = new FallbackGeminiClient(new LiveGeminiClient({ fetch: down }), new OfflineGeminiClient(), 'none');
    const panel = await client.matchGame(tenDal);
    expect(panel).toMatchObject({ available: false, source: 'none', events: [] });
    expect(panel.note).toMatch(/Gemini unreachable.*column hidden/);
  });

  it('a failed refresh keeps the last prices and says they are stale', async () => {
    let up = true;
    const good = fakeGemini({ search: { 'Tennessee vs Dallas': dallasSearch } });
    const client = new FallbackGeminiClient(new LiveGeminiClient({ fetch: (url, init) => (up ? good(url, init) : down(url, init)), now: () => NOW }), new OfflineGeminiClient());
    const panel = await client.matchGame(tenDal);
    up = false;
    const next = await client.refresh(panel);
    expect(next.events).toEqual(panel.events);
    expect(next.asOf).toBe(AS_OF);
    expect(next.note).toMatch(/refresh failed.*as of 2026-11-16T12:00:00.000Z/);
  });

  it('a slow Gemini cannot hold the caller past the deadline', async () => {
    const hang: FetchLike = () => new Promise(() => undefined);
    const client = new FallbackGeminiClient(new LiveGeminiClient({ fetch: hang, timeoutMs: 60_000 }), new OfflineGeminiClient(), 'mock', 30);
    const started = Date.now();
    const panel = await client.matchGame(tenDal);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(panel.source).toBe('mock');
    expect(panel.note).toMatch(/took longer than 30 ms/);
  });

  it('the offline mock is a full, self-consistent panel for both sports', async () => {
    const mock = new OfflineGeminiClient(() => NOW);
    expect(mock.source).toBe('mock');
    const nfl = await mock.matchGame(tenDal);
    expect(nfl.note).toMatch(/SAMPLE/);
    expect(nfl.events.map((e) => `${e.kind}${e.period ? ':' + e.period : ''}`)).toEqual(['moneyline', 'period_winner:1H', 'period_winner:1Q', 'period_winner:2H', 'period_winner:2Q', 'period_winner:3Q', 'period_winner:4Q', 'total']);
    for (const ev of nfl.events.filter((e) => e.kind !== 'total')) {
      const sum = ev.contracts.reduce((a, c) => a + (c.prob ?? 0), 0);
      expect(sum).toBeGreaterThan(0.97);
      expect(sum).toBeLessThan(1.03);
    }
    expect(mock.refFor(nfl, { kind: 'moneyline' }, WINNER, tenDal)).toMatchObject({ prob: 0.58, outcomeId: 'home' });
    expect(mock.refFor(nfl, { kind: 'total', line: 44.5 }, OVER_UNDER, tenDal)).toMatchObject({ prob: 0.5, outcomeId: 'over' });
    expect(mock.refFor(nfl, { kind: 'period_winner', period: '1Q' }, THREE_WAY, tenDal)).toMatchObject({ prob: 0.43, outcomeId: 'home' });

    const soccer = await mock.matchGame(porEsp);
    const outcomes: Outcome[] = [
      { id: 'home', label: 'Portugal' },
      { id: 'draw', label: 'Draw' },
      { id: 'away', label: 'Spain' },
    ];
    expect(mock.refFor(soccer, { kind: 'moneyline' }, outcomes, porEsp)).toMatchObject({ prob: 0.44, outcomeId: 'home' });
    expect(mock.refFor(soccer, { kind: 'moneyline' }, [outcomes[1]!], porEsp)).toMatchObject({ prob: 0.27, outcomeId: 'draw' });
    expect(mock.refFor(soccer, { kind: 'total', line: 2.5 }, [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], porEsp)).toMatchObject({ prob: 0.46, outcomeId: 'yes' });
  });

  it('createGeminiClient: live by default, GEMINI_MOCK forces the mock', () => {
    expect(createGeminiClient({}).source).toBe('live');
    expect(createGeminiClient({ GEMINI_API_BASE: 'https://api.gemini.com' })).toBeInstanceOf(FallbackGeminiClient);
    expect(createGeminiClient({ GEMINI_MOCK: '1' }).source).toBe('mock');
    expect(createGeminiClient({ GEMINI_MOCK: 'true' })).toBeInstanceOf(OfflineGeminiClient);
    expect(createGeminiClient({ GEMINI_MOCK: '0' }).source).toBe('live');
  });
});

describe('demo lookup', () => {
  it('translates NFL nicknames to the city Gemini uses', () => {
    expect(findNflTeam('49ers')?.city).toBe('San Francisco');
    expect(findNflTeam('cowboys')?.city).toBe('Dallas');
    expect(findNflTeam('DAL')?.nickname).toBe('Cowboys');
    expect(findNflTeam('Los Angeles Chargers')?.city).toBe('Los Angeles C');
    expect(findNflTeam('New York Jets')?.codes[0]).toBe('NYJ');
    expect(findNflTeam('Portugal')).toBeUndefined();
  });

  it('findGeminiMarkets groups a team search into games with mids', async () => {
    const calls: string[] = [];
    const found = await findGeminiMarkets('Cowboys', { fetch: fakeGemini({ search: { Dallas: dallasSearch } }, calls), now: () => NOW });
    expect(new URL(calls[0]!).searchParams.get('search')).toBe('Dallas');
    expect(found.term).toBe('Dallas');
    expect(found.games).toHaveLength(1);
    expect(found.games[0]).toMatchObject({ base: 'NFL-2611221800-TEN-DAL', title: 'Tennessee vs Dallas', startsAt: '2026-11-22T18:00:00.000Z', game: { home: { short: 'DAL' }, away: { short: 'TEN' } } });
    expect(found.others.map((e) => e.eventTicker)).toEqual(['NFLDALWINS26']);
    const text = formatMarkets(found);
    expect(text).toContain('NFL-2611221800-TEN-DAL-M  [moneyline]  Tennessee vs Dallas');
    expect(text).toMatch(/Dallas\s+bid 0\.79\s+ask 0\.80\s+last 0\.79\s+->\s+79\.5% \(mid\)/);
    expect(text).toMatch(/Tie in 1st Quarter.*unavailable/);

    const none = await findGeminiMarkets('49ers', { fetch: fakeGemini({}), now: () => NOW });
    expect(none.term).toBe('San Francisco');
    expect(formatMarkets(none)).toContain('No active game markets found.');
  });
});
