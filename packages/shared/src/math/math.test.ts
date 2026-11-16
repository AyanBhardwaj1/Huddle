import { describe, expect, it } from 'vitest';
import { USDC } from '../types';
import { defaultOddsForPrior, fillOffer, refundPairs, remainingTakerCapacity, settlePairs, takerStakeFor, type MatchedPair } from './bet';
import {
  addShares,
  lmsrCost,
  lmsrInitQ,
  lmsrLiquidity,
  lmsrPrices,
  lmsrWorstCaseLoss,
  normalizePrior,
  quoteBuyShares,
  quoteBuySpend,
  quoteSell,
  sharesPayout,
  subShares,
} from './lmsr';
import { poolPotential, poolShares, refundPool, settlePool, type PoolStake } from './pool';
import { brier, buildScorecard } from './scorecard';
import { settleClaims } from './settle';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe('LMSR', () => {
  const prior = { yes: 0.77, no: 0.23 };
  const L = 2 * USDC;
  const b = lmsrLiquidity(L, prior);
  const q0 = lmsrInitQ(prior, b);

  it('opens at the model prior with zero cost', () => {
    const p = lmsrPrices(q0, b);
    expect(p.yes).toBeCloseTo(0.77, 9);
    expect(p.no).toBeCloseTo(0.23, 9);
    expect(lmsrCost(q0, b).abs().toNumber()).toBeLessThan(1e-12);
  });

  it('prices always sum to 1', () => {
    let q = q0;
    const r = rng(7);
    for (let i = 0; i < 50; i++) {
      q = quoteBuyShares(q, b, r() > 0.5 ? 'yes' : 'no', (r() * 3 + 0.01).toFixed(6)).newQ;
      const p = lmsrPrices(q, b);
      expect(p.yes! + p.no!).toBeCloseTo(1, 12);
    }
  });

  it('uses the PRD formula b = L / ln(n) for uniform priors', () => {
    const bu = lmsrLiquidity(L, { yes: 0.5, no: 0.5 });
    expect(bu).toBeCloseTo((2 / Math.log(2)) * 0.999, 5);
  });

  it('never risks more than the house budget, whatever the prior', () => {
    const priors: Record<string, number>[] = [{ a: 0.5, b: 0.5 }, { a: 0.77, b: 0.23 }, { a: 0.97, b: 0.03 }, { a: 0.999, b: 0.001 }, { a: 0.6, b: 0.3, c: 0.1 }];
    for (const p of priors) {
      const bb = lmsrLiquidity(L, p);
      expect(lmsrWorstCaseLoss(p, bb)).toBeLessThanOrEqual(L);
    }
  });

  it('marginal cost matches the quoted price (cost/price consistency)', () => {
    const tiny = quoteBuyShares(q0, b, 'yes', '0.001000');
    expect(tiny.cost / USDC / 0.001).toBeCloseTo(0.77, 2);
    // Average price of a real buy sits between the price before and after.
    const buy = quoteBuyShares(q0, b, 'yes', '2.000000');
    expect(buy.avgPrice).toBeGreaterThan(0.77);
    expect(buy.avgPrice).toBeLessThan(buy.priceAfter + 1e-6);
    expect(buy.priceAfter).toBeGreaterThan(0.77);
  });

  it('buying moves the price up, selling moves it down', () => {
    const buy = quoteBuyShares(q0, b, 'no', '1.000000');
    expect(buy.priceAfter).toBeGreaterThan(0.23);
    const sell = quoteSell(buy.newQ, b, 'no', '1.000000');
    expect(sell.priceAfter).toBeCloseTo(0.23, 9);
  });

  it('rounds in the house favor: a round trip never profits', () => {
    const r = rng(11);
    for (let i = 0; i < 200; i++) {
      const shares = (r() * 5 + 0.000001).toFixed(6);
      const side = r() > 0.5 ? 'yes' : 'no';
      const buy = quoteBuyShares(q0, b, side, shares);
      const sell = quoteSell(buy.newQ, b, side, shares);
      expect(sell.proceeds).toBeLessThanOrEqual(buy.cost);
      expect(buy.cost - sell.proceeds).toBeLessThanOrEqual(2);
    }
  });

  it('quoteBuySpend never charges more than the spend and wastes at most dust', () => {
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const spend = Math.floor(r() * 8 * USDC) + 1000;
      const side = r() > 0.5 ? 'yes' : 'no';
      const quote = quoteBuySpend(q0, b, side, spend);
      expect(quote.cost).toBeLessThanOrEqual(spend);
      expect(spend - quote.cost).toBeLessThanOrEqual(3);
      expect(Number(quote.shares)).toBeGreaterThan(0);
    }
  });

  it('rejects malformed share amounts', () => {
    expect(() => quoteBuyShares(q0, b, 'yes', '0')).toThrow();
    expect(() => quoteBuyShares(q0, b, 'yes', '1.0000001')).toThrow();
    expect(() => quoteBuyShares(q0, b, 'maybe', '1')).toThrow();
    expect(() => subShares('1.000000', '2.000000')).toThrow();
  });

  it('escrow (house budget + net trades) always covers the winning payout, and the ledger is conserved', () => {
    for (const [seed, pr] of [[1, { yes: 0.77, no: 0.23 }], [2, { yes: 0.05, no: 0.95 }], [3, { a: 0.5, b: 0.3, c: 0.2 }]] as const) {
      const r = rng(seed);
      const ids = Object.keys(pr);
      const bb = lmsrLiquidity(L, pr);
      let q = lmsrInitQ(pr, bb);
      let escrow = L;
      const held: Record<string, Record<string, string>> = {};
      const cash: Record<string, number> = { p0: 0, p1: 0, p2: 0 };
      for (let i = 0; i < 300; i++) {
        const player = `p${Math.floor(r() * 3)}`;
        const outcome = ids[Math.floor(r() * ids.length)]!;
        held[player] ??= {};
        const have = held[player]![outcome];
        if (have && Number(have) > 0 && r() < 0.35) {
          const sell = quoteSell(q, bb, outcome, have);
          q = sell.newQ;
          escrow -= sell.proceeds;
          cash[player]! += sell.proceeds;
          held[player]![outcome] = subShares(have, have);
        } else {
          const buy = quoteBuySpend(q, bb, outcome, Math.floor(r() * 6 * USDC) + 5000);
          q = buy.newQ;
          escrow += buy.cost;
          cash[player]! -= buy.cost;
          held[player]![outcome] = addShares(have, buy.shares);
        }
        expect(escrow).toBeGreaterThanOrEqual(0);
        for (const win of ids) {
          const owed = Object.values(held).reduce((a, h) => a + (h[win] ? sharesPayout(h[win]!) : 0), 0);
          expect(escrow).toBeGreaterThanOrEqual(owed);
        }
      }
      // Resolve on each outcome: players' cash + house remainder == house budget (nothing created or lost).
      for (const win of ids) {
        const owed = Object.values(held).reduce((a, h) => a + (h[win] ? sharesPayout(h[win]!) : 0), 0);
        const houseBack = escrow - owed;
        const playersNet = Object.values(cash).reduce((a, c) => a + c, 0) + owed;
        expect(houseBack + playersNet).toBe(L);
        expect(L - houseBack).toBeLessThanOrEqual(L); // house loss bounded by its budget
      }
    }
  });

  it('normalizes and clamps priors', () => {
    const p = normalizePrior({ a: 0.999, b: 0.001 });
    expect(p.a! + p.b!).toBeCloseTo(1, 12);
    expect(p.b!).toBeGreaterThanOrEqual(0.0196);
  });
});

describe('Pool', () => {
  const stakes: PoolStake[] = [
    { player: 'a', outcome: 'yes', stake: 3_333_333 },
    { player: 'b', outcome: 'yes', stake: 1_000_001 },
    { player: 'c', outcome: 'no', stake: 7_000_000 },
    { player: 'a', outcome: 'no', stake: 500_000 },
  ];

  it('payouts plus dust equal the whole pool', () => {
    for (const win of ['yes', 'no']) {
      const s = settlePool(stakes, win);
      const paid = Object.values(s.payouts).reduce((a, c) => a + c, 0);
      expect(paid + s.dust).toBe(s.total);
      expect(s.dust).toBeGreaterThanOrEqual(0);
      expect(s.dust).toBeLessThan(stakes.length);
      expect(s.refunded).toBe(false);
    }
  });

  it('winners split pro rata', () => {
    const s = settlePool(
      [
        { player: 'a', outcome: 'yes', stake: 1 * USDC },
        { player: 'b', outcome: 'yes', stake: 3 * USDC },
        { player: 'c', outcome: 'no', stake: 4 * USDC },
      ],
      'yes',
    );
    expect(s.payouts).toEqual({ a: 2 * USDC, b: 6 * USDC });
  });

  it('refunds everyone when nobody backed the winner', () => {
    const s = settlePool(stakes, 'maybe');
    expect(s.refunded).toBe(true);
    expect(s.payouts).toEqual(refundPool(stakes));
    expect(s.dust).toBe(0);
  });

  it('random pools conserve money', () => {
    const r = rng(42);
    for (let t = 0; t < 100; t++) {
      const ss: PoolStake[] = Array.from({ length: 1 + Math.floor(r() * 12) }, (_, i) => ({
        player: `p${i % 5}`,
        outcome: ['x', 'y', 'z'][Math.floor(r() * 3)]!,
        stake: 100_000 + Math.floor(r() * 9_000_000),
      }));
      const s = settlePool(ss, 'x');
      expect(Object.values(s.payouts).reduce((a, c) => a + c, 0) + s.dust).toBe(s.total);
    }
  });

  it('shows pool shares, falling back to the prior when empty', () => {
    expect(poolShares({}, ['yes', 'no'], { yes: 0.77, no: 0.23 })).toEqual({ yes: 0.77, no: 0.23 });
    expect(poolShares({ yes: 3, no: 1 }, ['yes', 'no'])).toEqual({ yes: 0.75, no: 0.25 });
    expect(poolPotential({ yes: 2 * USDC, no: 2 * USDC }, 'yes', 1 * USDC)).toBe(2 * USDC);
  });
});

describe('Bet (head-to-head)', () => {
  it('prices the default offer from the model (77% -> 1.30)', () => {
    expect(defaultOddsForPrior(0.77)).toBe(1.3);
    expect(defaultOddsForPrior(0.5)).toBe(2);
  });

  it('taker stake = makerStake x (odds - 1)', () => {
    expect(takerStakeFor(10 * USDC, 1.3)).toBe(3 * USDC);
    expect(remainingTakerCapacity({ makerStake: 10 * USDC, odds: 1.3, filled: 5 * USDC })).toBe(1.5 * USDC);
  });

  it('supports partial fills by several takers and never over-matches', () => {
    const offer = { makerStake: 10 * USDC, odds: 1.3, filled: 0 };
    const f1 = fillOffer(offer, 1 * USDC);
    expect(f1.takerStake).toBe(1 * USDC);
    expect(f1.makerPortion).toBe(3_333_333);
    expect(f1.complete).toBe(false);
    offer.filled = f1.newFilled;
    const f2 = fillOffer(offer, 50 * USDC); // more than is left
    expect(f2.complete).toBe(true);
    expect(f2.makerPortion).toBe(10 * USDC - 3_333_333);
    expect(f2.takerStake).toBe(takerStakeFor(10 * USDC - 3_333_333, 1.3));
    offer.filled = f2.newFilled;
    expect(() => fillOffer(offer, USDC)).toThrow();
  });

  it('winner of each pair takes both stakes; voids refund at cost', () => {
    const pairs: MatchedPair[] = [
      { maker: 'm', taker: 't1', side: 'yes', makerPortion: 5 * USDC, takerStake: 1.5 * USDC },
      { maker: 'm', taker: 't2', side: 'yes', makerPortion: 5 * USDC, takerStake: 1.5 * USDC },
    ];
    const total = 13 * USDC;
    const yes = settlePairs(pairs, 'yes');
    expect(yes).toEqual({ m: total });
    const no = settlePairs(pairs, 'no');
    expect(no).toEqual({ t1: 6.5 * USDC, t2: 6.5 * USDC });
    const refund = refundPairs(pairs);
    expect(Object.values(refund).reduce((a, c) => a + c, 0)).toBe(total);
    expect(refund.m).toBe(10 * USDC);
  });
});

describe('Vault finalize math', () => {
  const deposits = { a: 10 * USDC, b: 10 * USDC, c: 10 * USDC };

  it('pays claims in full and returns surplus + bond to the host', () => {
    const r = settleClaims({ deposits, claims: { a: 14 * USDC, b: 6 * USDC, c: 9 * USDC }, bond: 5 * USDC });
    expect(r.payouts).toEqual({ a: 14 * USDC, b: 6 * USDC, c: 9 * USDC });
    expect(r.hostRefund).toBe(6 * USDC);
    expect(r.cut).toBe(false);
  });

  it('defaults missing claims to the deposit and covers the shortfall from the bond', () => {
    // a won 4 from b, but b's losing state was never submitted.
    const r = settleClaims({ deposits, claims: { a: 14 * USDC }, bond: 5 * USDC });
    expect(r.payouts).toEqual({ a: 14 * USDC, b: 10 * USDC, c: 10 * USDC });
    expect(r.shortfall).toBe(4 * USDC);
    expect(r.hostRefund).toBe(1 * USDC);
    expect(r.cut).toBe(false);
  });

  it('cuts every claim pro rata when the bond is not enough', () => {
    const r = settleClaims({ deposits, claims: { a: 30 * USDC }, bond: 5 * USDC });
    expect(r.cut).toBe(true);
    const paid = Object.values(r.payouts).reduce((x, y) => x + y, 0);
    expect(paid + r.hostRefund).toBe(35 * USDC);
    expect(r.payouts.a).toBe(21 * USDC);
    expect(r.payouts.b).toBe(7 * USDC);
    expect(r.hostRefund).toBeLessThan(3);
  });
});

describe('Scorecard', () => {
  it('computes Brier scores and names a winner', () => {
    expect(brier([1, 1])).toBe(0);
    expect(brier([0.5])).toBe(0.25);
    expect(brier([])).toBeNull();
    const sc = buildScorecard([
      { marketId: '1', question: 'q1', outcome: 'yes', room: 0.9, model: 0.6, gemini: 0.95 },
      { marketId: '2', question: 'q2', outcome: 'no', room: 0.6, model: 0.5 },
    ]);
    expect(sc.n).toBe(2);
    expect(sc.nGemini).toBe(1);
    expect(sc.brier.room).toBeCloseTo((0.01 + 0.16) / 2, 10);
    expect(sc.brier.model).toBeCloseTo((0.16 + 0.25) / 2, 10);
    expect(sc.brier.gemini).toBeCloseTo(0.0025, 10);
    expect(sc.verdict).toContain('The room beat the model by 0.12');
    expect(sc.verdict).toContain('Gemini still wins');
  });
});
