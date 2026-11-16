import {
  DEFAULT_PARTY_CONFIG,
  lmsrInitQ,
  lmsrLiquidity,
  USDC,
  type BalanceState,
  type BetOffer,
  type Fill,
  type Market,
  type Position,
} from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import {
  ammBuyPreview,
  ammCashOutValue,
  backQuote,
  countdown,
  formatClock,
  friendlyError,
  groupMarkets,
  holdingsFor,
  marketResult,
  maxStake,
  poolPayoutPerDollar,
  poolPreview,
  prosRow,
  stakeChips,
  takeableOffers,
  takerOdds,
  takerWin,
} from './markets';
import { money, moneyShort, pnl } from './money';
import { cleanName, loadLastSigned, loadName, loadOrCreateWallet, memoryKv, saveLastSigned, saveName } from './wallet';

const T0 = Date.parse('2026-11-18T20:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function mk(p: Partial<Market> & { id: string }): Market {
  return {
    partyId: 'p',
    question: 'Q?',
    kind: 'moment',
    mode: 'pool',
    outcomes: [
      { id: 'yes', label: 'YES' },
      { id: 'no', label: 'NO' },
    ],
    prior: { yes: 0.77, no: 0.23 },
    lock: { manual: true },
    resolver: { type: 'x', params: {} },
    state: 'open',
    createdBy: 'ai',
    price: { yes: 0.77, no: 0.23 },
    volume: 0,
    createdAt: iso(T0),
    ...p,
  };
}

describe('wallet storage', () => {
  it('creates a wallet once and reloads the same key', async () => {
    const kv = memoryKv();
    const a = await loadOrCreateWallet(kv);
    const b = await loadOrCreateWallet(kv);
    expect(a.publicKey).toBe(b.publicKey);
    expect(Array.from(b.secretKey)).toEqual(Array.from(a.secretKey));
    expect(a.secretKey.length).toBe(64);
  });

  it('replaces a corrupt wallet entry', async () => {
    const kv = memoryKv();
    await kv.set('huddle:wallet', { v: 1, publicKey: 'nope', secretKey: [1, 2, 3] });
    const kp = await loadOrCreateWallet(kv);
    expect(kp.publicKey.length).toBeGreaterThan(30);
    expect((await loadOrCreateWallet(kv)).publicKey).toBe(kp.publicKey);
  });

  it('stores a cleaned display name', async () => {
    const kv = memoryKv();
    expect(await loadName(kv)).toBeNull();
    await saveName(kv, '  Jake   the  Snake ');
    expect(await loadName(kv)).toBe('Jake the Snake');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
    await expect(saveName(kv, '   ')).rejects.toThrow();
  });

  it('keeps the newest countersigned state per party and never goes backwards', async () => {
    const kv = memoryKv();
    const st = (nonce: number): BalanceState => ({
      member: 'M',
      nonce,
      balance: nonce * USDC,
      prevBalance: 0,
      stateHash: String(nonce),
      prevStateHash: '0',
      entries: [],
      boxSig: 'b',
      memberSig: 'm',
    });
    expect(await loadLastSigned(kv, 'abcd', 'M')).toBeNull();
    expect(await saveLastSigned(kv, 'abcd', st(2))).toBe(true);
    expect(await saveLastSigned(kv, 'ABCD', st(1))).toBe(false);
    expect((await loadLastSigned(kv, 'ABCD', 'M'))?.nonce).toBe(2);
    expect(await saveLastSigned(kv, 'abcd', st(3))).toBe(true);
    expect((await loadLastSigned(kv, 'abcd', 'M'))?.nonce).toBe(3);
    expect(await loadLastSigned(kv, 'OTHER', 'M')).toBeNull();
  });
});

describe('market sorting', () => {
  it('puts open moments first by soonest lock, then game, waiting, settled newest first', () => {
    const ms = [
      mk({ id: 'g1', kind: 'game', openedAt: iso(T0) }),
      mk({ id: 'm-late', lock: { manual: true, at: iso(T0 + 30_000) } }),
      mk({ id: 'm-soon', lock: { manual: true, at: iso(T0 + 5_000) } }),
      mk({ id: 'g2', kind: 'game', openedAt: iso(T0 + 1000) }),
      mk({ id: 'locked', state: 'locked' }),
      mk({ id: 'r-old', state: 'final', resolvedAt: iso(T0 - 60_000) }),
      mk({ id: 'r-new', state: 'resolved', resolvedAt: iso(T0 - 1000) }),
      mk({ id: 'v', state: 'voided', resolvedAt: iso(T0 - 30_000) }),
      mk({ id: 'draft', state: 'draft' }),
      mk({ id: 'disc', state: 'discarded' }),
    ];
    const g = groupMarkets(ms);
    expect(g.moments.map((m) => m.id)).toEqual(['m-soon', 'm-late']);
    expect(g.game.map((m) => m.id)).toEqual(['g2', 'g1']);
    expect(g.waiting.map((m) => m.id)).toEqual(['locked']);
    expect(g.settled.map((m) => m.id)).toEqual(['r-new', 'v', 'r-old']);
    expect(groupMarkets(ms, 1).settled).toHaveLength(1);
  });
});

describe('countdown', () => {
  const m = { lock: { manual: true as const, at: iso(T0 + 20_000) }, openedAt: iso(T0), createdAt: iso(T0) };
  it('runs from 1 to 0 across the open window', () => {
    expect(countdown(m, T0)).toMatchObject({ fraction: 1, secs: 20, urgent: false });
    expect(countdown(m, T0 + 15_500)).toMatchObject({ secs: 5, urgent: true });
    expect(countdown(m, T0 + 10_000)!.fraction).toBeCloseTo(0.5);
    expect(countdown(m, T0 + 25_000)).toMatchObject({ remainingMs: 0, fraction: 0, secs: 0 });
  });
  it('returns null without a lock time', () => {
    expect(countdown({ lock: { manual: true }, createdAt: iso(T0) }, T0)).toBeNull();
  });
  it('formats clocks', () => {
    expect(formatClock(18)).toBe('0:18');
    expect(formatClock(245)).toBe('4:05');
    expect(formatClock(3720)).toBe('1:02:00');
  });
});

describe('stakes', () => {
  const cfg = DEFAULT_PARTY_CONFIG;
  it('offers $1/$2/$5 under the cap plus max', () => {
    expect(maxStake(10 * USDC, cfg)).toBe(5 * USDC);
    expect(stakeChips(10 * USDC, cfg)).toEqual([
      { amount: 1 * USDC, isMax: false },
      { amount: 2 * USDC, isMax: false },
      { amount: 5 * USDC, isMax: true },
    ]);
    expect(stakeChips(30 * USDC, cfg).map((c) => c.amount / USDC)).toEqual([1, 2, 5, 15]);
    expect(stakeChips(3 * USDC, cfg).map((c) => c.amount / USDC)).toEqual([1, 1.5]);
  });
  it('respects an extra cap and the minimum stake', () => {
    expect(stakeChips(30 * USDC, cfg, 1.5 * USDC).map((c) => c.amount / USDC)).toEqual([1, 1.5]);
    expect(stakeChips(0.1 * USDC, cfg)).toEqual([]);
  });
});

describe('pool previews', () => {
  const m = mk({ id: 'p', pool: { yes: 6 * USDC, no: 2 * USDC } });
  it('quotes $1 pays and new-stake potential', () => {
    expect(poolPayoutPerDollar(m, 'no')).toBe(4);
    expect(poolPayoutPerDollar(m, 'yes')).toBeCloseTo(1.33);
    expect(poolPreview(m, 'no', 2 * USDC)).toBe(5 * USDC); // 2 * 10 / 4
    expect(poolPayoutPerDollar(mk({ id: 'e', pool: {} }), 'yes')).toBe(1.3);
  });
});

describe('amm previews', () => {
  const prior = { yes: 0.77, no: 0.23 };
  const b = lmsrLiquidity(2 * USDC, prior);
  const m = mk({ id: 'a', mode: 'amm', prior, ammB: b, q: lmsrInitQ(prior, b) });
  it('buy preview never spends more than asked and pays 1 per share', () => {
    const p = ammBuyPreview(m, 'yes', 2 * USDC)!;
    expect(p.cost).toBeLessThanOrEqual(2 * USDC);
    expect(p.payout).toBe(Math.floor(Number(p.shares) * USDC));
    expect(p.payout).toBeGreaterThan(2 * USDC);
    expect(p.priceAfter).toBeGreaterThan(0.77);
  });
  it('cash-out value is below cost right after buying (no free money) and null without shares', () => {
    const p = ammBuyPreview(m, 'yes', 2 * USDC)!;
    const after = { ...m, q: { ...m.q!, yes: String(Number(m.q!.yes) + Number(p.shares)) } };
    const v = ammCashOutValue(after, p.shares, 'yes')!;
    expect(v).toBeLessThanOrEqual(p.cost);
    expect(v).toBeGreaterThan(p.cost - 10);
    expect(ammCashOutValue(m, undefined, 'yes')).toBeNull();
    expect(ammBuyPreview({ ...m, q: undefined }, 'yes', USDC)).toBeNull();
  });
});

describe('positions and results', () => {
  const me = 'ME';
  const pos = (o: string, stake: number, extra: Partial<Position> = {}): Position => ({
    partyId: 'p',
    marketId: 'r',
    player: me,
    outcome: o,
    stake,
    ...extra,
  });
  it('merges holdings per outcome', () => {
    const m = mk({ id: 'r', pool: { yes: 4 * USDC, no: 4 * USDC } });
    const h = holdingsFor(m, [pos('yes', USDC), pos('yes', USDC), pos('no', USDC, { marketId: 'other' })]);
    expect(h).toHaveLength(1);
    expect(h[0]!.stake).toBe(2 * USDC);
    expect(h[0]!.potential).toBe(4 * USDC); // each 1 USDC of 4 on yes in an 8 pool returns 2
  });
  it('wins, losses and refunds', () => {
    const won = mk({ id: 'r', state: 'final', outcome: 'yes', pool: { yes: 2 * USDC, no: 2 * USDC } });
    expect(marketResult(won, [pos('yes', 2 * USDC)], [], me)).toEqual({ kind: 'won', amount: 2 * USDC, stake: 2 * USDC });
    expect(marketResult({ ...won, outcome: 'no' }, [pos('yes', 2 * USDC)], [], me)).toEqual({ kind: 'lost', amount: 2 * USDC });
    expect(marketResult({ ...won, state: 'voided' }, [pos('yes', 2 * USDC)], [], me)).toEqual({ kind: 'refunded', amount: 2 * USDC });
    expect(marketResult(won, [], [], me)).toEqual({ kind: 'none' });
    const payout: Fill = { id: 'f', marketId: 'r', player: me, playerName: 'Me', kind: 'payout', outcome: 'yes', amount: 5 * USDC, at: iso(T0) };
    expect(marketResult(won, [pos('yes', 2 * USDC)], [payout], me)).toEqual({ kind: 'won', amount: 3 * USDC, stake: 2 * USDC });
  });
});

describe('head-to-head', () => {
  const offer = (p: Partial<BetOffer>): BetOffer => ({
    id: 'o',
    marketId: 'b',
    maker: 'JAKE',
    makerName: 'Jake',
    side: 'no',
    makerStake: 10 * USDC,
    odds: 2.1,
    filled: 0,
    open: true,
    createdAt: iso(T0),
    ...p,
  });
  it('converts maker odds to taker odds', () => {
    expect(takerOdds(2)).toBe(2);
    expect(takerOdds(1.3)).toBeCloseTo(4.33);
    expect(takerOdds(2.1)).toBeCloseTo(1.91);
  });
  it('taker winnings are capped by what is left of the offer', () => {
    const o = offer({ filled: 4 * USDC });
    expect(takerWin(o, 1.1 * USDC)).toBe(USDC);
    expect(takerWin(o, 100 * USDC)).toBe(6 * USDC);
    expect(takerWin(o, 0)).toBe(0);
  });
  it('lists only friends live offers, best for the taker first', () => {
    const list = [
      offer({ id: 'a', odds: 3 }),
      offer({ id: 'b', odds: 2.1 }),
      offer({ id: 'mine', maker: 'ME' }),
      offer({ id: 'full', filled: 10 * USDC }),
      offer({ id: 'closed', open: false }),
      offer({ id: 'elsewhere', marketId: 'x' }),
    ];
    expect(takeableOffers('b', list, 'ME').map((o) => o.id)).toEqual(['b', 'a']);
  });
  it('one-tap back uses a better friend offer, else the model odds', () => {
    const m = mk({ id: 'b', mode: 'bet', prior: { yes: 0.5, no: 0.5 } });
    expect(backQuote(m, 'yes', [], 'ME')).toEqual({ odds: 2, matchesOffer: false });
    const q = backQuote(m, 'yes', [offer({ odds: 1.5 })], 'ME');
    expect(q).toMatchObject({ odds: 3, matchesOffer: true, makerName: 'Jake' });
    expect(backQuote(m, 'yes', [offer({ odds: 3 })], 'ME').matchesOffer).toBe(false);
  });
});

describe('friends vs the pros', () => {
  it('uses the gemini outcome when present', () => {
    const m = mk({
      id: 'g',
      geminiRef: { eventTicker: 'E', contractTicker: 'C', prob: 0.71, asOf: iso(T0), outcomeId: 'no' },
      price: { yes: 0.6, no: 0.4 },
    });
    expect(prosRow(m)).toMatchObject({ outcomeId: 'no', room: 0.4, model: 0.23, gemini: 0.71 });
    expect(prosRow({ ...m, geminiRef: undefined })).toMatchObject({ outcomeId: 'yes', room: 0.6, gemini: undefined });
    const cat = mk({ id: 'c', outcomes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] });
    expect(prosRow(cat)).toBeNull();
  });
});

describe('formatting and errors', () => {
  it('formats money in dollars and points', () => {
    expect(money(14.2 * USDC, false)).toBe('$14.20');
    expect(money(14.2 * USDC, true)).toBe('14.20 pts');
    expect(moneyShort(USDC, false)).toBe('$1');
    expect(moneyShort(2.5 * USDC, false)).toBe('$2.50');
    expect(moneyShort(5 * USDC, true)).toBe('5 pts');
    expect(pnl(-3 * USDC, false)).toBe('−$3.00');
    expect(pnl(4.2 * USDC, false)).toBe('+$4.20');
  });
  it('maps engine errors to friendly copy', () => {
    expect(friendlyError({ code: 'market_closed' })).toMatch(/locked/);
    expect(friendlyError(new Error('request timed out'))).toMatch(/connection/);
    expect(friendlyError(new Error('weird'))).toMatch(/Try again/);
  });
});
