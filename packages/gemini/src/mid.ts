/** Mid-price rule for Gemini Prediction Markets quotes (PRD section 11). Pure. */

export const MAX_SPREAD = 0.1;

export interface RawPrices {
  bestBid?: unknown;
  bestAsk?: unknown;
  lastTradePrice?: unknown;
}

export interface Quote {
  /** Probability in 0..1, or null when Gemini has no usable price (never a misleading number). */
  prob: number | null;
  source: 'mid' | 'last' | 'unavailable';
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
}

/** Gemini sends prices as strings in the 0..1 range. Anything else is treated as missing. */
export function parsePrice(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/**
 * mid = (bestBid + bestAsk) / 2.
 * If the spread is wider than 0.10, or a side is missing (or the book is crossed), use lastTradePrice.
 * If that is missing too, the quote is `unavailable` with `prob: null`.
 */
export function quoteFromPrices(prices: RawPrices | null | undefined): Quote {
  const bestBid = parsePrice(prices?.bestBid);
  const bestAsk = parsePrice(prices?.bestAsk);
  const lastTradePrice = parsePrice(prices?.lastTradePrice);
  const out: Quote = { prob: null, source: 'unavailable' };
  if (bestBid !== undefined) out.bestBid = bestBid;
  if (bestAsk !== undefined) out.bestAsk = bestAsk;
  if (lastTradePrice !== undefined) out.lastTradePrice = lastTradePrice;

  if (bestBid !== undefined && bestAsk !== undefined) {
    const spread = bestAsk - bestBid;
    if (spread >= -1e-9 && spread <= MAX_SPREAD + 1e-9) {
      out.prob = Math.round(((bestBid + bestAsk) / 2) * 1e4) / 1e4;
      out.source = 'mid';
      return out;
    }
  }
  if (lastTradePrice !== undefined) {
    out.prob = lastTradePrice;
    out.source = 'last';
  }
  return out;
}
