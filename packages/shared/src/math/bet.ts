import { Decimal } from 'decimal.js';

/**
 * Head-to-head bets (PRD section 5, Mode 1).
 *
 * The maker backs `side` with `makerStake` at decimal `odds` (e.g. 1.30: stake 10 to win 3).
 * Takers put up the other side: full taker stake = makerStake * (odds - 1). Partial fills allowed.
 * The winner of each matched pair receives both stakes. There is no house, so nothing to round
 * "for the house"; we round so that neither side can be over-matched.
 */

export const MIN_ODDS = 1.01;
export const MAX_ODDS = 50;

export function roundOdds(odds: number): number {
  const o = Math.min(MAX_ODDS, Math.max(MIN_ODDS, odds));
  return Math.round(o * 100) / 100;
}

/** Fair decimal odds for a side with model probability `p` (77% -> 1.30). */
export function defaultOddsForPrior(p: number): number {
  const clamped = Math.min(0.99, Math.max(0.02, p));
  return roundOdds(1 / clamped);
}

/** Implied probability of the maker's side from decimal odds. */
export function impliedProb(odds: number): number {
  return 1 / odds;
}

/** Taker stake needed to match `makerPortion` of maker stake (rounded up, min 1). */
export function takerStakeFor(makerPortion: number, odds: number): number {
  if (makerPortion <= 0) return 0;
  return Math.max(1, new Decimal(makerPortion).mul(new Decimal(odds).sub(1)).ceil().toNumber());
}

export interface OfferLike {
  makerStake: number;
  odds: number;
  filled: number;
}

/** Taker stake that would fully match what is left of the offer. */
export function remainingTakerCapacity(offer: OfferLike): number {
  return takerStakeFor(offer.makerStake - offer.filled, offer.odds);
}

export interface OfferFill {
  /** Taker stake actually used, base units. */
  takerStake: number;
  /** Maker stake matched by this fill, base units. */
  makerPortion: number;
  /** offer.filled after this fill. */
  newFilled: number;
  /** True when the offer is now fully matched. */
  complete: boolean;
}

/**
 * Match `takerAmount` (taker stake, base units) against an offer.
 * If it covers the remaining capacity, the offer is completed and any excess is not used.
 */
export function fillOffer(offer: OfferLike, takerAmount: number): OfferFill {
  if (!Number.isInteger(takerAmount) || takerAmount <= 0) throw new Error('amount must be a positive integer');
  const remainingMaker = offer.makerStake - offer.filled;
  if (remainingMaker <= 0) throw new Error('offer is fully matched');
  const capacity = remainingTakerCapacity(offer);
  if (takerAmount >= capacity) {
    return { takerStake: capacity, makerPortion: remainingMaker, newFilled: offer.makerStake, complete: true };
  }
  const makerPortion = Math.min(
    remainingMaker,
    new Decimal(takerAmount).div(new Decimal(offer.odds).sub(1)).floor().toNumber(),
  );
  if (makerPortion <= 0) throw new Error('amount too small for these odds');
  return {
    takerStake: takerAmount,
    makerPortion,
    newFilled: offer.filled + makerPortion,
    complete: offer.filled + makerPortion >= offer.makerStake,
  };
}

export interface MatchedPair {
  maker: string;
  taker: string;
  /** Outcome the maker backs. */
  side: string;
  makerPortion: number;
  takerStake: number;
}

/** Winner of each matched pair receives both stakes. Returns base units per player. */
export function settlePairs(pairs: MatchedPair[], winningOutcome: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pairs) {
    const winner = p.side === winningOutcome ? p.maker : p.taker;
    out[winner] = (out[winner] ?? 0) + p.makerPortion + p.takerStake;
  }
  return out;
}

/** Void: both sides get their own stake back. */
export function refundPairs(pairs: MatchedPair[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pairs) {
    out[p.maker] = (out[p.maker] ?? 0) + p.makerPortion;
    out[p.taker] = (out[p.taker] ?? 0) + p.takerStake;
  }
  return out;
}
