import { Decimal } from 'decimal.js';
import { USDC } from '../types';

/**
 * LMSR market maker (PRD section 5, Mode 3).
 *
 * Units: shares and `b` are in USDC units (1 share pays 1 USDC). Costs/proceeds are returned in
 * integer base units, always rounded in the house's favor (buys round up, sells round down).
 * Share amounts are fixed to 6 decimals so that 1 micro-share pays exactly 1 base unit.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
type DecimalT = InstanceType<typeof D>;
type Q = Record<string, string>;

export const SHARE_DP = 6;
/** Priors are clamped to this range so `b` never collapses and prices stay tradable. */
export const MIN_PRIOR = 0.02;

/** Clamp and renormalize priors so each is >= MIN_PRIOR and they sum to exactly 1. */
export function normalizePrior(prior: Record<string, number>): Record<string, number> {
  const ids = Object.keys(prior);
  if (ids.length < 2) throw new Error('need at least 2 outcomes');
  const clamped = ids.map((id) => Math.max(MIN_PRIOR, Number.isFinite(prior[id]) ? prior[id]! : 0));
  const sum = clamped.reduce((a, c) => a + c, 0);
  const out: Record<string, number> = {};
  ids.forEach((id, i) => (out[id] = clamped[i]! / sum));
  return out;
}

/**
 * Liquidity parameter `b` (USDC units) for a house budget `budgetBase` (base units).
 *
 * The PRD formula is b = L / ln(n), which is the worst-case loss for *uniform* priors. Because we
 * open at the model's priors (q_i = b ln prior_i), the true worst-case loss is b * ln(1 / minPrior).
 * We use the tighter of the two so the house can never lose more than L. (DECISIONS.md #lmsr-b)
 */
export function lmsrLiquidity(budgetBase: number, prior: Record<string, number>): number {
  const p = normalizePrior(prior);
  const n = Object.keys(p).length;
  const minP = Math.min(...Object.values(p));
  const denom = Math.max(Math.log(n), Math.log(1 / minP));
  // Shave a hair so decimal rounding can never push the worst case above the budget.
  const b = (budgetBase / USDC / denom) * 0.999;
  return Math.floor(b * 1e6) / 1e6;
}

/** q_i = b ln(prior_i): the market opens at the model's probabilities with C(q) = 0. */
export function lmsrInitQ(prior: Record<string, number>, b: number): Q {
  const p = normalizePrior(prior);
  const q: Q = {};
  for (const [id, pi] of Object.entries(p)) q[id] = new D(pi).ln().mul(b).toFixed(18);
  return q;
}

function logSumExp(q: Q, b: number): DecimalT {
  const xs = Object.values(q).map((v) => new D(v).div(b));
  const max = D.max(...xs);
  let sum = new D(0);
  for (const x of xs) sum = sum.add(x.sub(max).exp());
  return max.add(sum.ln());
}

/** C(q) = b ln sum_j exp(q_j / b), in USDC units. */
export function lmsrCost(q: Q, b: number): DecimalT {
  return logSumExp(q, b).mul(b);
}

/** p_i = exp(q_i / b) / sum_j exp(q_j / b). Sums to 1. */
export function lmsrPrices(q: Q, b: number): Record<string, number> {
  const lse = logSumExp(q, b);
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(q)) out[id] = new D(v).div(b).sub(lse).exp().toNumber();
  return out;
}

function withDelta(q: Q, outcome: string, delta: DecimalT): Q {
  if (!(outcome in q)) throw new Error(`unknown outcome ${outcome}`);
  return { ...q, [outcome]: new D(q[outcome]!).add(delta).toFixed(18) };
}

function parseShares(shares: string): DecimalT {
  const s = new D(shares);
  if (!s.isFinite() || s.lte(0)) throw new Error('shares must be positive');
  if (s.decimalPlaces() > SHARE_DP) throw new Error(`shares limited to ${SHARE_DP} decimals`);
  return s;
}

export interface BuyQuote {
  shares: string;
  /** Base units the buyer pays (rounded up). */
  cost: number;
  newQ: Q;
  /** Average price per share, 0..1. */
  avgPrice: number;
  /** Price of the outcome after the trade. */
  priceAfter: number;
}

export interface SellQuote {
  shares: string;
  /** Base units the seller receives (rounded down). */
  proceeds: number;
  newQ: Q;
  avgPrice: number;
  priceAfter: number;
}

/** Cost of buying `shares` of `outcome`: C(q + d e_k) - C(q), rounded up. */
export function quoteBuyShares(q: Q, b: number, outcome: string, shares: string): BuyQuote {
  const d = parseShares(shares);
  const newQ = withDelta(q, outcome, d);
  const raw = lmsrCost(newQ, b).sub(lmsrCost(q, b)).mul(USDC);
  const cost = Math.max(1, raw.ceil().toNumber());
  return {
    shares: d.toFixed(SHARE_DP),
    cost,
    newQ,
    avgPrice: cost / USDC / d.toNumber(),
    priceAfter: lmsrPrices(newQ, b)[outcome]!,
  };
}

/**
 * Buy as many shares as `spendBase` affords. Shares are rounded down to 6 dp, then the exact cost
 * of those shares is charged (rounded up), so `cost <= spendBase` always.
 */
export function quoteBuySpend(q: Q, b: number, outcome: string, spendBase: number): BuyQuote {
  if (!Number.isInteger(spendBase) || spendBase <= 0) throw new Error('spend must be a positive integer');
  if (!(outcome in q)) throw new Error(`unknown outcome ${outcome}`);
  // Solve C(q + d e_k) = C(q) + spend for d:
  //   d = b * ln( exp((C0 + s)/b) - sum_{j != k} exp(q_j/b) ) - q_k
  // computed relative to C0 for numerical stability:
  //   d = C0 + b * ln( exp(s/b) - (1 - p_k) ) - q_k
  const s = new D(spendBase).div(USDC);
  const c0 = lmsrCost(q, b);
  const pk = new D(q[outcome]!).div(b).sub(c0.div(b)).exp();
  const inner = s.div(b).exp().sub(new D(1).sub(pk));
  let d = c0.add(inner.ln().mul(b)).sub(q[outcome]!);
  d = d.toDecimalPlaces(SHARE_DP, Decimal.ROUND_DOWN);
  if (d.lte(0)) throw new Error('spend too small');
  let quote = quoteBuyShares(q, b, outcome, d.toFixed(SHARE_DP));
  // Guard against a 1-unit overshoot from rounding the cost up.
  let guard = 0;
  while (quote.cost > spendBase && guard++ < 5) {
    d = d.sub(new D(1).div(10 ** SHARE_DP));
    if (d.lte(0)) throw new Error('spend too small');
    quote = quoteBuyShares(q, b, outcome, d.toFixed(SHARE_DP));
  }
  if (quote.cost > spendBase) throw new Error('spend too small');
  return quote;
}

/** Proceeds of selling (cashing out) `shares`: C(q) - C(q - d e_k), rounded down. */
export function quoteSell(q: Q, b: number, outcome: string, shares: string): SellQuote {
  const d = parseShares(shares);
  const newQ = withDelta(q, outcome, d.neg());
  const raw = lmsrCost(q, b).sub(lmsrCost(newQ, b)).mul(USDC);
  const proceeds = Math.max(0, raw.floor().toNumber());
  return {
    shares: d.toFixed(SHARE_DP),
    proceeds,
    newQ,
    avgPrice: proceeds / USDC / d.toNumber(),
    priceAfter: lmsrPrices(newQ, b)[outcome]!,
  };
}

/** Base units paid to a holder of `shares` of the winning outcome (1 share = 1 USDC, rounded down). */
export function sharesPayout(shares: string): number {
  return new D(shares).mul(USDC).floor().toNumber();
}

export function addShares(a: string | undefined, b: string): string {
  return new D(a ?? 0).add(b).toFixed(SHARE_DP);
}

export function subShares(a: string, b: string): string {
  const r = new D(a).sub(b);
  if (r.lt(0)) throw new Error('insufficient shares');
  return r.toFixed(SHARE_DP);
}

export function sharesGt(a: string, b: string): boolean {
  return new D(a).gt(b);
}

export function sharesIsZero(a: string | undefined): boolean {
  return !a || new D(a).isZero();
}

/** Worst-case house loss in base units for a market opened at `prior` with liquidity `b`. */
export function lmsrWorstCaseLoss(prior: Record<string, number>, b: number): number {
  const p = normalizePrior(prior);
  const minP = Math.min(...Object.values(p));
  return new D(1).div(minP).ln().mul(b).mul(USDC).ceil().toNumber();
}
