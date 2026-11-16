/**
 * Vault finalize math (PRD section 8, instruction 5). This is the reference implementation the
 * Anchor program mirrors, and what the mock settlement client runs.
 *
 * The vault holds `totalDeposits + bond`.
 *  - Members with no submitted claim default to their deposit.
 *  - If sum(claims) <= totalDeposits: everyone is paid in full; the surplus and the bond go to the host.
 *  - If sum(claims) > totalDeposits: the bond covers the shortfall; what is left of the bond goes to the host.
 *  - If the bond is not enough: every claim is cut pro rata to (totalDeposits + bond) / sum(claims),
 *    rounded down; rounding dust goes to the host.
 */

export interface SettleInput {
  /** member -> deposited base units. */
  deposits: Record<string, number>;
  /** member -> claimed final balance (latest verified signed state). Missing = default to deposit. */
  claims: Record<string, number | undefined>;
  bond: number;
}

export interface SettleResult {
  /** member -> base units they can withdraw. */
  payouts: Record<string, number>;
  /** Base units returned to the host (remaining bond + surplus + dust). */
  hostRefund: number;
  sumClaims: number;
  totalDeposits: number;
  shortfall: number;
  /** True when claims were cut pro rata. */
  cut: boolean;
}

export function settleClaims(input: SettleInput): SettleResult {
  const members = Object.keys(input.deposits);
  const totalDeposits = members.reduce((a, m) => a + input.deposits[m]!, 0);
  const effective: Record<string, number> = {};
  for (const m of members) effective[m] = input.claims[m] ?? input.deposits[m]!;
  const sumClaims = members.reduce((a, m) => a + effective[m]!, 0);
  const available = totalDeposits + input.bond;
  const payouts: Record<string, number> = {};

  if (sumClaims <= available) {
    for (const m of members) payouts[m] = effective[m]!;
    return {
      payouts,
      hostRefund: available - sumClaims,
      sumClaims,
      totalDeposits,
      shortfall: Math.max(0, sumClaims - totalDeposits),
      cut: false,
    };
  }

  let paid = 0;
  for (const m of members) {
    const p = Number((BigInt(effective[m]!) * BigInt(available)) / BigInt(sumClaims));
    payouts[m] = p;
    paid += p;
  }
  return {
    payouts,
    hostRefund: available - paid,
    sumClaims,
    totalDeposits,
    shortfall: sumClaims - totalDeposits,
    cut: true,
  };
}
