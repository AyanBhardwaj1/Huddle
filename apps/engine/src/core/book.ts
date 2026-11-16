import {
  poolPotential,
  refundPairs,
  refundPool,
  settlePairs,
  settlePool,
  sharesIsZero,
  sharesPayout,
  type BetOffer,
  type LedgerEntryType,
  type Market,
  type MarketCandidate,
  type MatchedPair,
  type PoolStake,
  type Position,
} from '@huddle/shared';

/**
 * Private per-market book: who holds what in each mode. Pure data + pure functions; the money
 * itself moves only through the ledger (see party-core.ts). All math comes from @huddle/shared.
 */

export interface Holding {
  /** AMM shares held, 6 dp decimal string. */
  shares: string;
  /** Cost basis of those shares, base units (reduced pro rata on sells; display only). */
  cost: number;
}

export interface Book {
  /** Countdown from open to lock, ms (already time-scaled). */
  lockAfterMs?: number;
  /** The same countdown in nominal seconds, for the announcer. */
  lockSecs?: number;
  /** AMM: budget L escrowed from the house when the market opened. */
  houseEscrow: number;
  /** Pool: player -> outcome -> stake. */
  stakes: Record<string, Record<string, number>>;
  /** AMM: player -> outcome -> holding. */
  holdings: Record<string, Record<string, Holding>>;
  /** AMM: player -> buys minus sells, base units (what a void refunds; may be negative). */
  netCost: Record<string, number>;
  /** Bet: matched pairs. */
  pairs: MatchedPair[];
  /** Settlement credits actually applied per member; null while unsettled. */
  applied: Record<string, number> | null;
  geminiHint?: MarketCandidate['geminiHint'];
  rationale?: string;
  lockSoonSent?: boolean;
}

export function emptyBook(): Book {
  return { houseEscrow: 0, stakes: {}, holdings: {}, netCost: {}, pairs: [], applied: null };
}

/** One line of a settlement: how part of a market's escrow is paid out. May be negative (claw-back). */
export interface Credit {
  member: string;
  amount: number;
  type: LedgerEntryType;
  memo?: string;
}

export function poolStakeList(book: Book): PoolStake[] {
  const out: PoolStake[] = [];
  for (const [player, byOutcome] of Object.entries(book.stakes)) {
    for (const [outcome, stake] of Object.entries(byOutcome)) if (stake > 0) out.push({ player, outcome, stake });
  }
  return out;
}

/** The outcome a taker is on. Binary: the other outcome. Categorical (D11): "anything but the maker's side". */
export function takerOutcome(market: Market, side: string): string {
  if (market.outcomes.length === 2) return market.outcomes.find((o) => o.id !== side)?.id ?? `not:${side}`;
  return `not:${side}`;
}

function withRemainder(credits: Credit[], escrow: number, house: string, memo: string): Credit[] {
  const paid = credits.reduce((a, c) => a + c.amount, 0);
  const rest = escrow - paid;
  if (rest !== 0) credits.push({ member: house, amount: rest, type: 'house_return', memo });
  return credits;
}

/**
 * How the market's whole escrow is paid out when `outcome` wins. The credits always sum to `escrow`.
 *  - pool: winners split the pool pro rata (floor); dust to the house; nobody on the winner -> refund.
 *  - amm:  1 share of the winner pays 1 USDC (floor); the rest of the escrow returns to the house.
 *  - bet:  the winner of each matched pair takes both stakes.
 */
export function resolveDistribution(market: Market, book: Book, outcome: string, escrow: number, house: string): Credit[] {
  const credits: Credit[] = [];
  if (market.mode === 'pool') {
    const res = settlePool(poolStakeList(book), outcome);
    for (const [member, amount] of Object.entries(res.payouts)) {
      credits.push({ member, amount, type: res.refunded ? 'refund' : 'payout', memo: res.refunded ? 'nobody backed the winner' : undefined });
    }
    return withRemainder(credits, escrow, house, 'pool dust');
  }
  if (market.mode === 'amm') {
    for (const [member, byOutcome] of Object.entries(book.holdings)) {
      const h = byOutcome[outcome];
      if (!h || sharesIsZero(h.shares)) continue;
      const amount = sharesPayout(h.shares);
      if (amount > 0) credits.push({ member, amount, type: 'payout' });
    }
    return withRemainder(credits, escrow, house, 'market maker');
  }
  for (const [member, amount] of Object.entries(settlePairs(book.pairs, outcome))) {
    credits.push({ member, amount, type: 'payout' });
  }
  return withRemainder(credits, escrow, house, 'bet remainder');
}

/**
 * Void: every stake and trade refunded at cost. The credits always sum to `escrow`.
 * AMM traders get their net cost back; a trader who already took out more than they put in
 * (sold at a profit) gets a negative credit, i.e. hands the profit back; the house gets its budget back.
 */
export function voidDistribution(market: Market, book: Book, escrow: number, house: string): Credit[] {
  const credits: Credit[] = [];
  if (market.mode === 'pool') {
    for (const [member, amount] of Object.entries(refundPool(poolStakeList(book)))) {
      credits.push({ member, amount, type: 'refund' });
    }
    return withRemainder(credits, escrow, house, 'pool remainder');
  }
  if (market.mode === 'amm') {
    for (const [member, net] of Object.entries(book.netCost)) {
      if (net > 0) credits.push({ member, amount: net, type: 'refund' });
      else if (net < 0) credits.push({ member, amount: net, type: 'adjust', memo: 'void: trading profit returned' });
    }
    return withRemainder(credits, escrow, house, 'market maker');
  }
  for (const [member, amount] of Object.entries(refundPairs(book.pairs))) {
    credits.push({ member, amount, type: 'refund' });
  }
  return withRemainder(credits, escrow, house, 'bet remainder');
}

/** Base units a player has at risk in a market, at cost (matched + unmatched). Always equals the sum of their position stakes plus their open offers. */
export function atRisk(market: Market, book: Book, offers: Iterable<BetOffer>, player: string): number {
  if (book.applied) return 0;
  if (market.mode === 'pool') {
    return Object.values(book.stakes[player] ?? {}).reduce((a, s) => a + s, 0);
  }
  if (market.mode === 'amm') {
    // Exposure = cost basis of the shares still held (what `Position.stake` shows), not net cash flow:
    // a position that was cashed out, at a profit or a loss, is no longer at risk.
    return Object.values(book.holdings[player] ?? {}).reduce((a, h) => a + h.cost, 0);
  }
  let total = 0;
  for (const p of book.pairs) {
    if (p.maker === player) total += p.makerPortion;
    if (p.taker === player) total += p.takerStake;
  }
  for (const o of offers) {
    if (o.marketId === market.id && o.open && o.maker === player) total += o.makerStake - o.filled;
  }
  return total;
}

/** Everyone with money in the market (matched or unmatched), excluding the house's AMM budget. */
export function participants(market: Market, book: Book, offers: Iterable<BetOffer>): string[] {
  const set = new Set<string>();
  if (market.mode === 'pool') for (const p of Object.keys(book.stakes)) set.add(p);
  else if (market.mode === 'amm') for (const p of Object.keys(book.netCost)) set.add(p);
  else {
    for (const p of book.pairs) {
      set.add(p.maker);
      set.add(p.taker);
    }
    for (const o of offers) if (o.marketId === market.id && o.open) set.add(o.maker);
  }
  return [...set];
}

/** A player's open positions in one market (empty once the market is settled). */
export function positionsOf(market: Market, book: Book, player: string): Position[] {
  if (book.applied) return [];
  const base = { partyId: market.partyId, marketId: market.id, player };
  const out: Position[] = [];
  if (market.mode === 'pool') {
    for (const [outcome, stake] of Object.entries(book.stakes[player] ?? {})) {
      if (stake > 0) out.push({ ...base, outcome, stake, potential: poolPotential(market.pool ?? {}, outcome, stake) });
    }
    return out;
  }
  if (market.mode === 'amm') {
    for (const [outcome, h] of Object.entries(book.holdings[player] ?? {})) {
      if (!sharesIsZero(h.shares)) out.push({ ...base, outcome, shares: h.shares, stake: h.cost, potential: sharesPayout(h.shares) });
    }
    return out;
  }
  const agg = new Map<string, { stake: number; potential: number }>();
  const add = (outcome: string, stake: number, potential: number): void => {
    const a = agg.get(outcome) ?? { stake: 0, potential: 0 };
    a.stake += stake;
    a.potential += potential;
    agg.set(outcome, a);
  };
  for (const p of book.pairs) {
    if (p.maker === player) add(p.side, p.makerPortion, p.makerPortion + p.takerStake);
    if (p.taker === player) add(takerOutcome(market, p.side), p.takerStake, p.makerPortion + p.takerStake);
  }
  for (const [outcome, a] of agg) out.push({ ...base, outcome, stake: a.stake, potential: a.potential });
  return out;
}
