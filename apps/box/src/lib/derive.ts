import {
  formatUsd,
  type Fill,
  type GameInfo,
  type Market,
  type MarketMode,
  type MarketState,
  type Party,
  type PlayerPublic,
  type Scorecard,
} from '@huddle/shared';
import { payoutText } from '@huddle/ui';

/** Pure view logic for the box screens (unit-tested in derive.test.ts). */

export const MODE_LABEL: Record<MarketMode, string> = { bet: 'Bet', pool: 'Pool', amm: 'Market' };
export const MODE_BLURB: Record<MarketMode, string> = {
  bet: 'Head-to-head: one friend offers odds, others take the other side.',
  pool: 'Pick a side, winners split the pot. Easiest to understand.',
  amm: 'Prices move with every trade. Cash out any time before the lock.',
};

export const isPoints = (party: Party | undefined | null) => party?.config.settlement === 'points';

export function money(base: number, party: Party | null | undefined, opts: { sign?: boolean } = {}): string {
  return formatUsd(base, { points: isPoints(party), sign: opts.sign });
}

/** "$12" / "12 pts" — whole units for big displays, cents only when needed. */
export function moneyShort(base: number, party: Party | null | undefined, opts: { sign?: boolean } = {}): string {
  const full = money(base, party, opts);
  return full.replace(/\.00(?= pts|$)/, '');
}

/** "$1 pays $1.30" (points: "1 pt pays 1.30"). */
export function payoutLine(prob: number | null | undefined, party: Party | null | undefined): string {
  // Long shots read "100+"; missing, 0 and 1 say so in words (never "pays 154.45" or "").
  return payoutText(prob, { points: isPoints(party) });
}

const ACTIVE: MarketState[] = ['open', 'locked'];

/** The moment market that owns the takeover: newest open one, else the newest locked one. */
export function activeMoment(markets: Market[]): Market | null {
  const moment = markets.filter((m) => m.kind === 'moment' && ACTIVE.includes(m.state));
  const newest = (list: Market[]) =>
    list.reduce<Market | null>((a, m) => (!a || (m.openedAt ?? m.createdAt) > (a.openedAt ?? a.createdAt) ? m : a), null);
  return newest(moment.filter((m) => m.state === 'open')) ?? newest(moment);
}

/** Game-long markets for the tiles: open first, then locked, then recently settled. */
export function gameTiles(markets: Market[], max = 4): Market[] {
  const rank: Partial<Record<MarketState, number>> = { open: 0, locked: 1, disputed: 2, resolved: 3, final: 4 };
  return markets
    .filter((m) => m.kind === 'game' && rank[m.state] !== undefined)
    .sort((a, b) => rank[a.state]! - rank[b.state]! || a.createdAt.localeCompare(b.createdAt))
    .slice(0, max);
}

export const drafts = (markets: Market[]) => markets.filter((m) => m.state === 'draft');
export const disputed = (markets: Market[]) => markets.filter((m) => m.state === 'disputed');

/** Room probability per outcome: engine-maintained `price`, falling back to the model prior. */
export function roomProb(m: Market, outcomeId: string): number {
  return m.price?.[outcomeId] ?? m.prior?.[outcomeId] ?? 1 / Math.max(1, m.outcomes.length);
}

export interface Countdown {
  remainingMs: number;
  /** 1 at open, 0 at lock. */
  fraction: number;
  urgent: boolean;
  label: string;
}

/** Lock countdown for a market with a wall-clock lock. `nowMs` is engine time. */
export function countdown(m: Market, nowMs: number, defaultSecs = 20): Countdown | null {
  if (m.state !== 'open' || !m.lock.at) return null;
  const end = Date.parse(m.lock.at);
  const start = m.openedAt ? Date.parse(m.openedAt) : end - defaultSecs * 1000;
  const total = Math.max(1000, end - start);
  const remainingMs = Math.max(0, end - nowMs);
  return {
    remainingMs,
    fraction: Math.min(1, remainingMs / total),
    urgent: remainingMs <= 5000,
    label: formatSecs(remainingMs),
  };
}

/** 18400 -> "19"; 83000 -> "1:23". Rounds up so "0" only shows at the lock. */
export function formatSecs(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Friends vs. the Pros for one market: probability each gives the same outcome. */
export interface ProsRow {
  outcomeLabel: string;
  room: number;
  model: number;
  gemini?: number;
  geminiLabel?: string;
}
export function prosRow(m: Market): ProsRow | null {
  const ref = m.geminiRef;
  const oid = ref?.outcomeId ?? m.outcomes[0]?.id;
  if (!oid) return null;
  const label = m.outcomes.find((o) => o.id === oid)?.label ?? oid;
  return {
    outcomeLabel: label,
    room: roomProb(m, oid),
    model: m.prior?.[oid] ?? roomProb(m, oid),
    gemini: ref ? ref.prob : undefined,
    geminiLabel: ref?.label,
  };
}

const SETTLED: MarketState[] = ['resolved', 'final', 'voided'];

/**
 * Markets that just settled since the previous render (open/locked/disputed -> resolved/final/voided).
 * `prev` empty means "first snapshot": nothing is reported, so a reload never replays old reveals.
 */
export function detectSettled(prev: ReadonlyMap<string, MarketState>, markets: Market[]): Market[] {
  if (prev.size === 0) return [];
  return markets.filter((m) => {
    const before = prev.get(m.id);
    if (!before || !SETTLED.includes(m.state)) return false;
    if (before === 'disputed') return m.state === 'voided'; // host voided a disputed result
    return before === 'open' || before === 'locked';
  });
}

export interface Backer {
  name: string;
  amount: number;
}
export interface ResultSummary {
  winnerLabel: string | null;
  winners: Backer[];
  losers: Backer[];
}

const STAKE_KINDS = new Set<Fill['kind']>(['pool_bet', 'amm_buy', 'offer_taken']);

/**
 * Who backed what, from the public fill feed (recent fills only, so this is "who won / lost what"
 * at the stake level; exact payouts arrive on the phones).
 */
export function resultSummary(m: Market, fills: Fill[]): ResultSummary {
  const net = new Map<string, { name: string; byOutcome: Map<string, number> }>();
  for (const f of fills) {
    if (f.marketId !== m.id) continue;
    const sign = STAKE_KINDS.has(f.kind) ? 1 : f.kind === 'amm_sell' ? -1 : 0;
    if (!sign) continue;
    const p = net.get(f.player) ?? { name: f.playerName, byOutcome: new Map() };
    p.byOutcome.set(f.outcome, (p.byOutcome.get(f.outcome) ?? 0) + sign * f.amount);
    net.set(f.player, p);
  }
  const winners: Backer[] = [];
  const losers: Backer[] = [];
  for (const { name, byOutcome } of net.values()) {
    let won = 0;
    let lost = 0;
    for (const [o, amt] of byOutcome) {
      if (amt <= 0) continue;
      if (o === m.outcome) won += amt;
      else lost += amt;
    }
    if (won > 0) winners.push({ name, amount: won });
    if (lost > 0) losers.push({ name, amount: lost });
  }
  const by = (a: Backer, b: Backer) => b.amount - a.amount || a.name.localeCompare(b.name);
  return {
    winnerLabel: m.outcomes.find((o) => o.id === m.outcome)?.label ?? null,
    winners: winners.sort(by),
    losers: losers.sort(by),
  };
}

/** Players ranked by P&L, house account excluded. */
export function leaderboard(players: PlayerPublic[]): PlayerPublic[] {
  return players.filter((p) => !p.isHouse).sort((a, b) => b.pnl - a.pnl || a.name.localeCompare(b.name));
}

export interface TickerItem {
  id: string;
  name: string;
  verb: string;
  amount: number;
  outcomeLabel: string;
  dir: 'up' | 'down';
  price?: number;
}
const VERB: Partial<Record<Fill['kind'], string>> = {
  pool_bet: 'backs',
  amm_buy: 'buys',
  amm_sell: 'cashes out',
  offer_posted: 'offers',
  offer_taken: 'takes',
};
/** Latest fills first, mapped for the trade ticker. Payouts/refunds/cancels are skipped. */
export function tickerItems(fills: Fill[], markets: Market[], max = 8): TickerItem[] {
  const out: TickerItem[] = [];
  for (let i = fills.length - 1; i >= 0 && out.length < max; i--) {
    const f = fills[i]!;
    const verb = VERB[f.kind];
    if (!verb) continue;
    const m = markets.find((x) => x.id === f.marketId);
    const idx = m?.outcomes.findIndex((o) => o.id === f.outcome) ?? -1;
    out.push({
      id: f.id,
      name: f.playerName,
      verb,
      amount: f.amount,
      outcomeLabel: m?.outcomes[idx]?.label ?? f.outcome,
      dir: idx <= 0 && f.kind !== 'amm_sell' ? 'up' : 'down',
      price: f.price,
    });
  }
  return out;
}

/** Color slot per outcome index: first = up (YES), second = down (NO), extra outcomes neutral. */
export function outcomeTone(index: number): 'up' | 'down' | 'neutral' {
  return index === 0 ? 'up' : index === 1 ? 'down' : 'neutral';
}

export type SettlementStep = { id: 'ended' | 'closing' | 'finalized'; label: string; state: 'done' | 'active' | 'todo' };
export function settlementSteps(party: Party): SettlementStep[] {
  const order: SettlementStep['id'][] = ['ended', 'closing', 'finalized'];
  const labels = isPoints(party)
    ? { ended: 'Game over', closing: 'Final check', finalized: 'Scores locked' }
    : { ended: 'Game over', closing: 'Challenge window', finalized: 'Paid out' };
  const at = order.indexOf(party.status as SettlementStep['id']);
  return order.map((id, i) => ({
    id,
    label: labels[id],
    state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? (id === 'finalized' ? 'done' : 'active') : 'todo',
  }));
}

/** Brier bars for the scorecard: lower is better; `best` marks the winner. */
export interface BrierBar {
  id: 'room' | 'model' | 'gemini';
  label: string;
  value: number | null;
  best: boolean;
}
export function brierBars(sc: Scorecard): BrierBar[] {
  const bars: BrierBar[] = [
    { id: 'room', label: 'Friends', value: sc.brier.room, best: false },
    { id: 'model', label: 'Model', value: sc.brier.model, best: false },
  ];
  if (sc.nGemini > 0) bars.push({ id: 'gemini', label: 'Gemini', value: sc.brier.gemini, best: false });
  const vals = bars.map((b) => b.value).filter((v): v is number => v !== null);
  if (vals.length) {
    const min = Math.min(...vals);
    for (const b of bars) b.best = b.value !== null && Math.abs(b.value - min) < 1e-9;
  }
  return bars;
}

/** Host NEXT button: board -> host panel -> scorecard -> board. */
export type BoardView = 'board' | 'host' | 'scorecard';
export function nextView(v: BoardView): BoardView {
  return v === 'board' ? 'host' : v === 'host' ? 'scorecard' : 'board';
}

/** Create-party game list: grouped by sport; live, then replay, then scheduled. */
export function groupGames(games: GameInfo[]): { sport: string; games: GameInfo[] }[] {
  const by = new Map<string, GameInfo[]>();
  for (const g of games) by.set(g.sport, [...(by.get(g.sport) ?? []), g]);
  const rank = (g: GameInfo) => (g.status === 'live' ? 0 : g.status === 'replay' ? 1 : g.status === 'scheduled' ? 2 : 3);
  return [...by.entries()].map(([sport, list]) => ({
    sport,
    games: [...list].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)),
  }));
}

/** Default persona per sport (PRD section 7). */
export const personaForSport = (sport: string) => (sport === 'nfl' ? 'nfl' : 'soccer') as 'nfl' | 'soccer';
