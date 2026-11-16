import {
  defaultOddsForPrior,
  payoutPerDollar,
  poolPotential,
  quoteBuySpend,
  quoteSell,
  remainingTakerCapacity,
  sharesIsZero,
  sharesPayout,
  USDC,
  type BetOffer,
  type ErrorCode,
  type Fill,
  type Market,
  type PartyConfig,
  type PlayerPublic,
  type Position,
} from '@huddle/shared';

/** Pure helpers behind the market cards. No React here: everything is unit-tested. */

// ---------------------------------------------------------------- sorting

export interface MarketGroups {
  /** Open moment markets, soonest lock first. */
  moments: Market[];
  /** Open game-long markets, newest first. */
  game: Market[];
  /** Locked, waiting for a result. */
  waiting: Market[];
  /** Resolved / disputed / final / voided, most recent first. */
  settled: Market[];
}

const ts = (s?: string) => (s ? Date.parse(s) : 0);

export function groupMarkets(markets: Market[], settledLimit = 6): MarketGroups {
  const moments: Market[] = [];
  const game: Market[] = [];
  const waiting: Market[] = [];
  const settled: Market[] = [];
  for (const m of markets) {
    if (m.state === 'open') (m.kind === 'moment' ? moments : game).push(m);
    else if (m.state === 'locked') waiting.push(m);
    else if (m.state === 'resolved' || m.state === 'disputed' || m.state === 'final' || m.state === 'voided')
      settled.push(m);
    // draft / discarded are never shown to players
  }
  moments.sort((a, b) => (ts(a.lock.at) || Infinity) - (ts(b.lock.at) || Infinity));
  game.sort((a, b) => ts(b.openedAt ?? b.createdAt) - ts(a.openedAt ?? a.createdAt));
  waiting.sort((a, b) => ts(b.lockedAt ?? b.createdAt) - ts(a.lockedAt ?? a.createdAt));
  settled.sort(
    (a, b) => ts(b.resolvedAt ?? b.lockedAt ?? b.createdAt) - ts(a.resolvedAt ?? a.lockedAt ?? a.createdAt),
  );
  return { moments, game, waiting, settled: settled.slice(0, settledLimit) };
}

// ---------------------------------------------------------------- countdown

export interface Countdown {
  remainingMs: number;
  /** 1 at open, 0 at lock. */
  fraction: number;
  /** Whole seconds left, rounded up ("3" until the last ms). */
  secs: number;
  urgent: boolean;
}

export function countdown(market: Pick<Market, 'lock' | 'openedAt' | 'createdAt'>, nowMs: number): Countdown | null {
  const at = ts(market.lock.at);
  if (!at) return null;
  const start = ts(market.openedAt ?? market.createdAt);
  const total = Math.max(1, at - (start && start < at ? start : at - 20_000));
  const remainingMs = Math.max(0, at - nowMs);
  const secs = Math.ceil(remainingMs / 1000);
  return { remainingMs, fraction: Math.min(1, remainingMs / total), secs, urgent: remainingMs <= 5000 };
}

/** "0:18", "4:05", "1:02:00" */
export function formatClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- stakes

export interface StakeChip {
  amount: number;
  isMax: boolean;
}

/** Largest stake allowed on one market: maxStakeFraction of the available balance. */
export function maxStake(balance: number, config: Pick<PartyConfig, 'maxStakeFraction'>): number {
  return Math.max(0, Math.floor(balance * config.maxStakeFraction));
}

/** Quick stake chips: $1, $2, $5 (those at or under the cap), then "max". Empty when nothing is affordable. */
export function stakeChips(
  balance: number,
  config: Pick<PartyConfig, 'maxStakeFraction' | 'minStake'>,
  cap = Infinity,
): StakeChip[] {
  const max = Math.min(maxStake(balance, config), cap);
  if (max < config.minStake) return [];
  const chips: StakeChip[] = [1, 2, 5]
    .map((d) => d * USDC)
    .filter((a) => a >= config.minStake && a < max)
    .map((amount) => ({ amount, isMax: false }));
  chips.push({ amount: max, isMax: true });
  return chips;
}

// ---------------------------------------------------------------- pool

export function poolTotal(market: Market): number {
  return Object.values(market.pool ?? {}).reduce((a, c) => a + c, 0);
}

/** Room probability for an outcome (engine-maintained price, falling back to the prior). */
export function roomProb(market: Market, outcome: string): number {
  return market.price?.[outcome] ?? market.prior[outcome] ?? 1 / market.outcomes.length;
}

/** Estimated return for a new pool stake if `outcome` wins (stake included). */
export function poolPreview(market: Market, outcome: string, stake: number): number {
  const pool = market.pool ?? {};
  return poolPotential(pool, outcome, stake, false);
}

/** "$1 pays $x" for the pool at its current split (falls back to the price when the pool is empty). */
export function poolPayoutPerDollar(market: Market, outcome: string): number {
  const total = poolTotal(market);
  const on = market.pool?.[outcome] ?? 0;
  if (total > 0 && on > 0) return Math.round((total / on) * 100) / 100;
  return payoutPerDollar(roomProb(market, outcome));
}

// ---------------------------------------------------------------- amm

export interface AmmBuyPreview {
  shares: string;
  cost: number;
  /** Base units returned if the outcome wins. */
  payout: number;
  priceAfter: number;
}

export function ammBuyPreview(market: Market, outcome: string, spend: number): AmmBuyPreview | null {
  if (!market.q || !market.ammB || spend <= 0) return null;
  try {
    const q = quoteBuySpend(market.q, market.ammB, outcome, spend);
    return { shares: q.shares, cost: q.cost, payout: sharesPayout(q.shares), priceAfter: q.priceAfter };
  } catch {
    return null;
  }
}

/** What selling the whole position returns right now ("Cash out now: $3.40"). */
export function ammCashOutValue(market: Market, shares: string | undefined, outcome: string): number | null {
  if (!market.q || !market.ammB || sharesIsZero(shares)) return null;
  try {
    return quoteSell(market.q, market.ammB, outcome, shares!).proceeds;
  } catch {
    return null;
  }
}

/** "12.40" from "12.403000" */
export function formatShares(shares: string | undefined): string {
  const n = Number(shares ?? 0);
  return n >= 100 ? n.toFixed(0) : n.toFixed(2);
}

// ---------------------------------------------------------------- positions

export interface Holding {
  outcome: string;
  stake: number;
  shares?: string;
  potential: number;
}

/** Merge a player's positions in one market into one holding per outcome. */
export function holdingsFor(market: Market, positions: Position[]): Holding[] {
  const by = new Map<string, Holding>();
  for (const p of positions) {
    if (p.marketId !== market.id) continue;
    const h = by.get(p.outcome) ?? { outcome: p.outcome, stake: 0, potential: 0 };
    h.stake += p.stake;
    if (p.shares) h.shares = (Number(h.shares ?? 0) + Number(p.shares)).toFixed(6);
    h.potential += p.potential ?? estimatePotential(market, p);
    by.set(p.outcome, h);
  }
  return [...by.values()].filter((h) => h.stake > 0 || !sharesIsZero(h.shares));
}

function estimatePotential(market: Market, p: Position): number {
  if (market.mode === 'amm') return p.shares ? sharesPayout(p.shares) : 0;
  if (market.mode === 'pool') return poolPotential(market.pool ?? {}, p.outcome, p.stake, true);
  return p.stake;
}

export type MarketResult =
  | { kind: 'none' }
  | { kind: 'won'; amount: number; stake: number }
  | { kind: 'lost'; amount: number }
  | { kind: 'refunded'; amount: number };

/**
 * The player's result on a settled market: prefer the engine's payout/refund fills, fall back to
 * positions. `amount` for "won" is the profit (payout minus stake).
 */
export function marketResult(market: Market, positions: Position[], fills: Fill[], me: string): MarketResult {
  const mine = positions.filter((p) => p.marketId === market.id);
  const stake = mine.reduce((a, p) => a + p.stake, 0);
  const myFills = fills.filter((f) => f.marketId === market.id && f.player === me);
  const refunds = myFills.filter((f) => f.kind === 'refund').reduce((a, f) => a + f.amount, 0);
  const payouts = myFills.filter((f) => f.kind === 'payout').reduce((a, f) => a + f.amount, 0);
  if (market.state === 'voided') return refunds || stake ? { kind: 'refunded', amount: refunds || stake } : { kind: 'none' };
  if (!market.outcome) return { kind: 'none' };
  if (!mine.length && !payouts) return { kind: 'none' };
  const staked = stake || myFills.filter((f) => f.kind === 'pool_bet' || f.kind === 'amm_buy').reduce((a, f) => a + f.amount, 0);
  if (payouts > 0) return { kind: 'won', amount: payouts - staked, stake: staked };
  const winners = mine.filter((p) => p.outcome === market.outcome);
  if (winners.length) {
    const h = holdingsFor(market, winners);
    const pay = h.reduce((a, x) => a + x.potential, 0);
    if (pay > 0) return { kind: 'won', amount: pay - staked, stake: staked };
  }
  return staked ? { kind: 'lost', amount: staked } : { kind: 'none' };
}

// ---------------------------------------------------------------- head-to-head bets

/** Decimal odds the taker gets on an offer made at `makerOdds` (maker 1.30 -> taker 4.33). */
export function takerOdds(makerOdds: number): number {
  if (makerOdds <= 1) return 0;
  return Math.round((1 + 1 / (makerOdds - 1)) * 100) / 100;
}

/** Maker stake matched (= taker winnings) for a taker stake of `amount`. */
export function takerWin(offer: Pick<BetOffer, 'makerStake' | 'filled' | 'odds'>, amount: number): number {
  const remaining = offer.makerStake - offer.filled;
  if (amount <= 0 || remaining <= 0) return 0;
  if (amount >= remainingTakerCapacity(offer)) return remaining;
  // Odds have 2 dp: integer math avoids 1.1e6 / 1.1 = 999999.99.
  const edge = Math.round(offer.odds * 100) - 100;
  return edge > 0 ? Math.min(remaining, Math.floor((amount * 100) / edge)) : 0;
}

export function isOfferLive(o: BetOffer): boolean {
  return o.open && o.filled < o.makerStake;
}

/** Friends' open offers on a market, best for a taker first. */
export function takeableOffers(marketId: string, offers: BetOffer[], me: string): BetOffer[] {
  return offers
    .filter((o) => o.marketId === marketId && o.maker !== me && isOfferLive(o))
    .sort((a, b) => a.odds - b.odds || b.makerStake - b.filled - (a.makerStake - a.filled));
}

export function myOffers(marketId: string, offers: BetOffer[], me: string): BetOffer[] {
  return offers.filter((o) => o.marketId === marketId && o.maker === me && isOfferLive(o));
}

export interface BackQuote {
  odds: number;
  /** True when the one-tap bet would match a friend's offer first (D10). */
  matchesOffer: boolean;
  makerName?: string;
}

/**
 * Odds shown on "Back YES at 1.30". On binary markets a friend's offer on the other side gives the
 * taker better-or-equal odds and is matched first; otherwise the remainder posts at the model's odds.
 */
export function backQuote(market: Market, outcome: string, offers: BetOffer[], me: string): BackQuote {
  const model = defaultOddsForPrior(market.prior[outcome] ?? 0.5);
  if (market.outcomes.length === 2) {
    const opposite = takeableOffers(market.id, offers, me).filter((o) => o.side !== outcome);
    const best = opposite[0];
    if (best) {
      const t = takerOdds(best.odds);
      if (t >= model) return { odds: t, matchesOffer: true, makerName: best.makerName };
    }
  }
  return { odds: model, matchesOffer: false };
}

/** Total returned (stake + winnings) for a stake at decimal odds. */
export function returnAt(stake: number, odds: number): number {
  return Math.floor(stake * odds);
}

// ---------------------------------------------------------------- friends vs. the pros

export interface ProsRow {
  outcomeId: string;
  label: string;
  room: number;
  model: number;
  gemini?: number;
  geminiAsOf?: string;
}

/** Comparable markets: binary, or any market with a Gemini reference. */
export function prosRow(market: Market): ProsRow | null {
  const ref = market.geminiRef;
  if (market.outcomes.length !== 2 && !ref) return null;
  const oid = ref?.outcomeId ?? market.outcomes[0]?.id;
  const outcome = market.outcomes.find((o) => o.id === oid);
  if (!outcome) return null;
  return {
    outcomeId: outcome.id,
    label: outcome.label,
    room: roomProb(market, outcome.id),
    model: market.prior[outcome.id] ?? 0,
    gemini: ref?.prob,
    geminiAsOf: ref?.asOf,
  };
}

/** "just now", "2m ago", "1h ago" */
export function ago(iso: string | undefined, nowMs: number): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 30) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// ---------------------------------------------------------------- errors

const FRIENDLY: Partial<Record<ErrorCode, string>> = {
  stake_limit: "That's over your limit for one question (half your balance).",
  insufficient_funds: 'Not enough balance for that. Top up to keep playing.',
  min_stake: 'That stake is below the minimum.',
  cosign_required: 'Syncing your balance. Try again in a second.',
  market_closed: 'Too late, this one just locked.',
  delay_restricted: "You're too far behind the room's TV for quick bets.",
  rate_limited: 'Easy there. Try again in a moment.',
  party_closed: 'This party has ended.',
  not_joined: 'Reconnecting to the party. Try again in a second.',
  not_found: "That's no longer available.",
};

export function friendlyError(err: unknown): string {
  const code = (err as { code?: ErrorCode } | null)?.code;
  if (code && FRIENDLY[code]) return FRIENDLY[code]!;
  const msg = (err as Error | null)?.message ?? '';
  if (/timed out|not connected|connection closed/i.test(msg)) return "Couldn't reach the party. Check your connection.";
  return "Couldn't do that. Try again.";
}

// ---------------------------------------------------------------- leaderboard

/** Players ranked by P&L (the house account is never on the board). */
export function rankPlayers(players: PlayerPublic[]): PlayerPublic[] {
  return players.filter((p) => !p.isHouse).sort((a, b) => b.pnl - a.pnl || a.name.localeCompare(b.name));
}
