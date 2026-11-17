/**
 * Display formatting for odds. Every helper is total: NaN, undefined, 0, 1 and out-of-range values
 * produce a readable string, never an empty one (the old board showed a bare "%" for a fresh
 * market and "1 pt pays 154.45" for a 0.6% outcome).
 */

const isNum = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p);

/** Clamp a probability into [0, 1]; non-numbers become null. */
export function clampProb(p: number | null | undefined): number | null {
  if (!isNum(p)) return null;
  return Math.min(1, Math.max(0, p));
}

/**
 * Whole-number percentage text without the sign: 0.7712 -> "77".
 * Tiny but non-zero -> "<1", almost certain -> ">99", missing -> "–".
 */
export function pctText(p: number | null | undefined): string {
  const v = clampProb(p);
  if (v === null) return '–';
  if (v > 0 && v < 0.005) return '<1';
  if (v < 1 && v > 0.995) return '>99';
  return String(Math.round(v * 100));
}

/** Numeric part used for rolling digits and direction (null when unknown). */
export function pctValue(p: number | null | undefined): number | null {
  const v = clampProb(p);
  return v === null ? null : Math.round(v * 1000) / 10;
}

/** Spoken/accessible form: "77 percent". */
export function pctLabel(p: number | null | undefined): string {
  const t = pctText(p);
  if (t === '–') return 'no price yet';
  if (t === '<1') return 'under 1 percent';
  if (t === '>99') return 'over 99 percent';
  return `${t} percent`;
}

/**
 * Decimal payout per 1 unit staked at probability p, rounded for people:
 * under 10 -> two decimals ("1.30"), 10 to 99 -> whole ("15"), 100+ -> "100+".
 * Returns null when there is no meaningful payout (p missing, 0, or 1).
 */
export function multiplierText(p: number | null | undefined): string | null {
  const v = clampProb(p);
  if (v === null || v <= 0 || v >= 1) return null;
  const x = 1 / v;
  if (x >= 100) return '100+';
  if (x >= 10) return String(Math.round(x));
  return x.toFixed(2);
}

/**
 * "$1 pays $1.30" / "1 pt pays 1.30". Certain outcomes say so instead of "pays $1.00", and
 * missing prices say "No price yet".
 */
export function payoutText(p: number | null | undefined, opts: { points?: boolean } = {}): string {
  const v = clampProb(p);
  if (v === null) return 'No price yet';
  if (v >= 1) return 'Sure thing, no payout';
  const m = multiplierText(v);
  if (m === null) return 'Long shot, no takers yet';
  return opts.points ? `1 pt pays ${m}` : `$1 pays $${m}`;
}

/** Normalise a set of probabilities so they sum to 1 (for split bars); missing -> equal shares. */
export function normalise(ps: (number | null | undefined)[]): number[] {
  const vals = ps.map((p) => clampProb(p) ?? 0);
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum <= 0) return vals.map(() => 1 / Math.max(1, vals.length));
  return vals.map((v) => v / sum);
}
