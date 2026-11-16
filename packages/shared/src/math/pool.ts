/**
 * Pari-mutuel pool (PRD section 5, Mode 2). Integer math only (BigInt for the product).
 * payout_i = floor(stake_i * S_total / S_winning). Rounding dust goes to the house (host).
 * If nobody backed the winner, everyone is refunded.
 */

export interface PoolStake {
  player: string;
  outcome: string;
  stake: number;
}

export interface PoolSettlement {
  /** Base units returned to each player (winners: stake share of the whole pool). */
  payouts: Record<string, number>;
  /** Rounding remainder, credited to the house. */
  dust: number;
  /** True when nobody backed the winning outcome and all stakes were returned. */
  refunded: boolean;
  total: number;
}

export function poolTotals(stakes: PoolStake[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of stakes) out[s.outcome] = (out[s.outcome] ?? 0) + s.stake;
  return out;
}

/** Displayed odds = share of the pool on each outcome; falls back to `prior` while the pool is empty. */
export function poolShares(
  pool: Record<string, number>,
  outcomeIds: string[],
  prior?: Record<string, number>,
): Record<string, number> {
  const total = outcomeIds.reduce((a, id) => a + (pool[id] ?? 0), 0);
  const out: Record<string, number> = {};
  for (const id of outcomeIds) {
    out[id] = total > 0 ? (pool[id] ?? 0) / total : (prior?.[id] ?? 1 / outcomeIds.length);
  }
  return out;
}

/** What `stake` on `outcome` would return if it won, given the pool *after* adding the stake. */
export function poolPotential(pool: Record<string, number>, outcome: string, stake: number, alreadyIn = true): number {
  const total = Object.values(pool).reduce((a, c) => a + c, 0) + (alreadyIn ? 0 : stake);
  const winning = (pool[outcome] ?? 0) + (alreadyIn ? 0 : stake);
  if (winning <= 0) return 0;
  return Number((BigInt(stake) * BigInt(total)) / BigInt(winning));
}

export function settlePool(stakes: PoolStake[], winningOutcome: string): PoolSettlement {
  const total = stakes.reduce((a, s) => a + s.stake, 0);
  const winning = stakes.filter((s) => s.outcome === winningOutcome).reduce((a, s) => a + s.stake, 0);
  const payouts: Record<string, number> = {};
  if (winning === 0) {
    for (const s of stakes) payouts[s.player] = (payouts[s.player] ?? 0) + s.stake;
    return { payouts, dust: 0, refunded: true, total };
  }
  let paid = 0;
  for (const s of stakes) {
    if (s.outcome !== winningOutcome) continue;
    const p = Number((BigInt(s.stake) * BigInt(total)) / BigInt(winning));
    payouts[s.player] = (payouts[s.player] ?? 0) + p;
    paid += p;
  }
  return { payouts, dust: total - paid, refunded: false, total };
}

/** Void: every stake refunded at cost. */
export function refundPool(stakes: PoolStake[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of stakes) out[s.player] = (out[s.player] ?? 0) + s.stake;
  return out;
}
