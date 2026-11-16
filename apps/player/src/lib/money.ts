import { formatUsd, USDC } from '@huddle/shared';

/** Full money string: "$14.20" / "-$3.00" / "+$2.50" / "14.20 pts". */
export function money(base: number, points: boolean, opts: { sign?: boolean } = {}): string {
  return formatUsd(base, { points, sign: opts.sign });
}

/** Compact money for chips and buttons: "$1", "$2.50", "5 pts". */
export function moneyShort(base: number, points: boolean): string {
  const v = Math.abs(base) / USDC;
  const body = Number.isInteger(v) ? String(v) : v.toFixed(2);
  const sign = base < 0 ? '-' : '';
  return points ? `${sign}${body} pts` : `${sign}$${body}`;
}

/** Signed P&L with a typographic minus, e.g. "+$4.20", "−$3.00". */
export function pnl(base: number, points: boolean): string {
  if (base === 0) return money(0, points);
  return money(base, points, { sign: true }).replace(/^-/, '−');
}
