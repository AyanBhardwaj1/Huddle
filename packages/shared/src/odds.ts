import { USDC } from './types';

/** Parse a human USDC amount ("10", "0.10") into base units. */
export function toBase(usdc: number | string): number {
  const n = typeof usdc === 'string' ? Number(usdc) : usdc;
  if (!Number.isFinite(n)) throw new Error('invalid amount');
  return Math.round(n * USDC);
}

export function fromBase(base: number): number {
  return base / USDC;
}

/** "$14.20" (or "14.20 pts" in points mode). */
export function formatUsd(base: number, opts: { points?: boolean; sign?: boolean } = {}): string {
  const abs = Math.abs(base) / USDC;
  const body = abs.toFixed(2);
  const sign = base < 0 ? '-' : opts.sign && base > 0 ? '+' : '';
  return opts.points ? `${sign}${body} pts` : `${sign}$${body}`;
}

/** "77%" */
export function formatPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Decimal payout per $1 staked at probability p: 0.77 -> 1.30. */
export function payoutPerDollar(p: number): number {
  if (p <= 0) return 0;
  return Math.round((1 / p) * 100) / 100;
}

/** "$1 pays $1.30" */
export function formatPayout(p: number): string {
  return `$1 pays $${payoutPerDollar(p).toFixed(2)}`;
}

/** American odds for NFL: 0.77 -> "-335", 0.23 -> "+335". */
export function americanOdds(p: number): string {
  if (p <= 0 || p >= 1) return '—';
  if (p >= 0.5) return `-${Math.round((p / (1 - p)) * 100)}`;
  return `+${Math.round(((1 - p) / p) * 100)}`;
}
