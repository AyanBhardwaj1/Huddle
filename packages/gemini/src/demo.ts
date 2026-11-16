import type { GameInfo, GeminiPanel } from '@huddle/shared';
import { GeminiApi, type GeminiOptions } from './client';
import { buildPanel, classifyEvent, eventIsSport, eventStart, tickerBase, toEventQuote, type EventQuote, type RawEvent } from './mapping';
import { findNflTeam } from './teams';

export interface FoundGame {
  /** Ticker without the market suffix, e.g. NFL-2611221800-TEN-DAL. */
  base: string;
  title: string;
  startsAt?: string;
  game: GameInfo;
  panel: GeminiPanel;
}

function gameFromEvent(ev: RawEvent, sport: GameInfo['sport']): GameInfo {
  const home = ev.participants?.find((p) => p.side === 'home');
  const away = ev.participants?.find((p) => p.side === 'away');
  const seg = (ev.ticker ?? '').split('-');
  const start = eventStart(ev);
  const info: GameInfo = {
    id: tickerBase(ev.ticker ?? ''),
    sport,
    title: (ev.title ?? '').split(':')[0]!.trim(),
    home: { name: home?.name ?? 'Home', short: home?.abbreviation ?? seg[seg.length - 2] ?? 'HOME' },
    away: { name: away?.name ?? 'Away', short: away?.abbreviation ?? seg[seg.length - 3] ?? 'AWAY' },
    status: ev.isLive ? 'live' : 'scheduled',
    source: 'mock',
  };
  if (start !== undefined) info.startsAt = new Date(start).toISOString();
  return info;
}

/**
 * Standalone lookup for the bounty demo: live Gemini markets and mids for a team or free text.
 * NFL nicknames are translated to the city Gemini uses in titles ("49ers" -> "San Francisco").
 * Returns one entry per game, soonest first, plus any other matching events (futures and so on).
 */
export async function findGeminiMarkets(
  search: string,
  opts: GeminiOptions = {},
): Promise<{ term: string; games: FoundGame[]; others: EventQuote[]; asOf: string }> {
  const api = new GeminiApi(opts);
  const nfl = findNflTeam(search);
  const term = nfl ? nfl.city : search.trim();
  const asOf = new Date((opts.now ?? Date.now)()).toISOString();
  let events = await api.searchEvents(term);
  if (nfl) events = events.filter((e) => eventIsSport(e, 'nfl') || (e.ticker ?? '').startsWith('NFL'));

  const groups = new Map<string, RawEvent[]>();
  const loose: RawEvent[] = [];
  for (const ev of events) {
    const isGame = (ev.participants?.length ?? 0) >= 2 && /-\d{10}-/.test(ev.ticker ?? '');
    if (!isGame) {
      loose.push(ev);
      continue;
    }
    const base = tickerBase(ev.ticker!);
    groups.set(base, [...(groups.get(base) ?? []), ev]);
  }

  const games: FoundGame[] = [];
  for (const [base, evs] of groups) {
    const lead = evs.find((e) => classifyEvent(e).kind === 'moneyline') ?? evs[0]!;
    const sport: GameInfo['sport'] = (lead.ticker ?? '').startsWith('NFL-') ? 'nfl' : 'soccer';
    const game = gameFromEvent(lead, sport);
    const found: FoundGame = { base, title: game.title, game, panel: buildPanel(evs, game, 'live', asOf) };
    if (game.startsAt) found.startsAt = game.startsAt;
    games.push(found);
  }
  games.sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9'));
  const stub: GameInfo = { id: 'x', sport: 'nfl', title: '', home: { name: '-', short: '-' }, away: { name: '-', short: '-' }, status: 'scheduled', source: 'mock' };
  return { term, games, others: loose.slice(0, 5).map((e) => toEventQuote(e, stub, asOf)), asOf };
}

function price(n: number | undefined): string {
  return n === undefined ? '  - ' : n.toFixed(2);
}

/** Plain-text table for the terminal. */
export function formatMarkets(found: Awaited<ReturnType<typeof findGeminiMarkets>>): string {
  const lines: string[] = [`Gemini Prediction Markets, search "${found.term}", as of ${found.asOf}`];
  const table = (events: EventQuote[]): void => {
    for (const ev of events) {
      lines.push(`  ${ev.eventTicker}  [${ev.kind}${ev.period ? ' ' + ev.period : ''}]  ${ev.title}`);
      for (const c of ev.contracts) {
        const mid = c.prob === null ? 'unavailable' : `${(c.prob * 100).toFixed(1)}%`;
        lines.push(`      ${c.label.padEnd(44).slice(0, 44)} bid ${price(c.bestBid)}  ask ${price(c.bestAsk)}  last ${price(c.lastTradePrice)}  -> ${mid.padStart(11)} (${c.source})`);
      }
    }
  };
  if (found.games.length === 0) lines.push('No active game markets found.');
  for (const g of found.games) {
    lines.push('', `${g.title}  (${g.game.away.short} at ${g.game.home.short}, starts ${g.startsAt ?? 'unknown'})${g.panel.available ? '' : '  [no usable prices]'}`);
    if (g.panel.note) lines.push(`  note: ${g.panel.note}`);
    table(g.panel.events as EventQuote[]);
    const url = g.panel.events[0]?.url;
    if (url) lines.push(`  link: ${url}`);
  }
  if (found.others.length > 0) {
    lines.push('', 'Other matching events:');
    table(found.others);
  }
  return lines.join('\n');
}
