import { USDC, checkBalanceState, generateKeyPair, lmsrWorstCaseLoss, type AnnouncerEvent, type BalanceState } from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import { EngineError } from './errors';
import type { Effect } from './party-core';
import { T0, YES_NO, binary, makeKit, openMarket, type Kit } from './testkit';

const SEC = 1000;

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof EngineError) return e.code;
    throw e;
  }
  return 'ok';
}

function bal(kit: Kit, i: number): number {
  return kit.core.ledger.balanceOf(kit.players[i]!.publicKey);
}

function houseBal(kit: Kit): number {
  return kit.core.ledger.balanceOf(kit.house.publicKey);
}

function announced(effects: Effect[]): AnnouncerEvent['type'][] {
  return effects.flatMap((e) => (e.t === 'announce' ? [e.event.type] : []));
}

describe('pool mode', () => {
  it('takes stakes, shows pool shares as odds and pays winners pro rata', () => {
    const kit = makeKit();
    const [a, b, c] = kit.players.map((p) => p.publicKey) as [string, string, string];
    const id = openMarket(kit, { mode: 'pool' });
    const m = kit.core.rec(id).market;
    expect(m.price).toEqual({ yes: 0.77, no: 0.23 }); // model prior while the pool is empty
    kit.core.placeBet(a, id, 'yes', 3 * USDC, T0);
    kit.core.placeBet(b, id, 'yes', 1 * USDC, T0);
    kit.core.placeBet(c, id, 'no', 2 * USDC, T0);
    expect(m.pool).toEqual({ yes: 4 * USDC, no: 2 * USDC });
    expect(m.price.yes).toBeCloseTo(4 / 6);
    expect(m.volume).toBe(6 * USDC);
    expect(kit.core.ledger.escrowOf(id)).toBe(6 * USDC);
    expect(kit.core.positionsFor(a, id)).toEqual([
      { partyId: 'p1', marketId: id, player: a, outcome: 'yes', stake: 3 * USDC, potential: 4_500_000 },
    ]);
    kit.assertMoney();

    kit.core.resolveMarket(id, 'yes', T0 + SEC);
    expect(m.state).toBe('resolved');
    expect(m.roomProbAtLock!.yes).toBeCloseTo(4 / 6);
    expect(bal(kit, 0)).toBe(10 * USDC - 3 * USDC + 4_500_000);
    expect(bal(kit, 1)).toBe(10 * USDC - 1 * USDC + 1_500_000);
    expect(bal(kit, 2)).toBe(8 * USDC);
    expect(kit.core.ledger.escrowOf(id)).toBe(0);
    expect(kit.core.positionsFor(a, id)).toEqual([]);
    kit.assertMoney();
  });

  it('sends rounding dust to the house and never loses a unit', () => {
    const kit = makeKit();
    const [a, b, c] = kit.players.map((p) => p.publicKey) as [string, string, string];
    const id = openMarket(kit, { mode: 'pool' });
    kit.core.placeBet(a, id, 'yes', 1_000_001, T0);
    kit.core.placeBet(b, id, 'yes', 2_000_000, T0);
    kit.core.placeBet(c, id, 'no', 1_000_000, T0);
    const before = houseBal(kit);
    kit.core.resolveMarket(id, 'yes', T0);
    const paid = bal(kit, 0) - (10 * USDC - 1_000_001) + (bal(kit, 1) - (10 * USDC - 2_000_000));
    const dust = houseBal(kit) - before;
    expect(dust).toBeGreaterThan(0);
    expect(paid + dust).toBe(4_000_001);
    kit.assertMoney();
  });

  it('refunds everyone when nobody backed the winner', () => {
    const kit = makeKit();
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const id = openMarket(kit, { mode: 'pool' });
    kit.core.placeBet(a, id, 'yes', 3 * USDC, T0);
    kit.core.placeBet(b, id, 'yes', 1 * USDC, T0);
    kit.core.resolveMarket(id, 'no', T0);
    expect(bal(kit, 0)).toBe(10 * USDC);
    expect(bal(kit, 1)).toBe(10 * USDC);
    const last = kit.core.ledger.latest(a)!.state;
    expect(last.entries[0]!.type).toBe('refund');
    kit.assertMoney();
  });
});

describe('stake limits', () => {
  it('enforces the minimum, the available balance and the per-market cap', () => {
    const kit = makeKit();
    const a = kit.players[0]!.publicKey;
    const id = openMarket(kit, { mode: 'pool' });
    expect(code(() => kit.core.placeBet(a, id, 'yes', 50_000, T0))).toBe('min_stake');
    expect(code(() => kit.core.placeBet(a, id, 'yes', 11 * USDC, T0))).toBe('insufficient_funds');
    expect(code(() => kit.core.placeBet(a, id, 'yes', 6 * USDC, T0))).toBe('stake_limit');
    expect(code(() => kit.core.placeBet(a, id, 'maybe', 1 * USDC, T0))).toBe('bad_request');
    expect(bal(kit, 0)).toBe(10 * USDC); // nothing moved
    expect(kit.core.maxStakeFor(a, id)).toBe(5 * USDC);
    expect(code(() => kit.core.placeBet(a, id, 'yes', 5 * USDC, T0))).toBe('ok');
    // 50% of (balance + what is already in this market) is used up.
    expect(kit.core.maxStakeFor(a, id)).toBe(0);
    expect(code(() => kit.core.placeBet(a, id, 'no', 100_000, T0))).toBe('stake_limit');
    // A different market has its own cap, based on the remaining balance.
    const id2 = openMarket(kit, { mode: 'pool', question: 'Another?' });
    expect(kit.core.maxStakeFor(a, id2)).toBe(2_500_000);
    expect(code(() => kit.core.placeBet(a, id2, 'yes', 2_500_001, T0))).toBe('stake_limit');
    expect(code(() => kit.core.placeBet(a, id2, 'yes', 2_500_000, T0))).toBe('ok');
    kit.assertMoney();
  });

  it('rejects bets on markets that are not open, from strangers and from the house', () => {
    const kit = makeKit();
    const a = kit.players[0]!.publicKey;
    const draft = kit.core.createMarket(binary({ mode: 'pool' }), T0);
    expect(code(() => kit.core.placeBet(a, draft.id, 'yes', USDC, T0))).toBe('market_closed');
    const id = openMarket(kit, { mode: 'pool', lockAfterSecs: 20 });
    expect(code(() => kit.core.placeBet('nobody', id, 'yes', USDC, T0))).toBe('not_joined');
    expect(code(() => kit.core.placeBet(kit.house.publicKey, id, 'yes', USDC, T0))).toBe('unauthorized');
    // Past the countdown but before the tick that locks it: still refused.
    expect(code(() => kit.core.placeBet(a, id, 'yes', USDC, T0 + 20 * SEC))).toBe('market_closed');
    kit.core.lockMarket(id, T0);
    expect(code(() => kit.core.placeBet(a, id, 'yes', USDC, T0))).toBe('market_closed');
    expect(code(() => kit.core.placeBet(a, 'nope', 'yes', USDC, T0))).toBe('not_found');
    kit.core.setStatus('ended');
    const id2 = kit.core.rec(id).market.id;
    expect(code(() => kit.core.placeBet(a, id2, 'yes', USDC, T0))).toBe('party_closed');
  });
});

describe('market (AMM) mode', () => {
  it('escrows the house budget, opens at the model prior and moves the price with trades', () => {
    const kit = makeKit();
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const id = openMarket(kit, { mode: 'amm' });
    const m = kit.core.rec(id).market;
    expect(m.mode).toBe('amm');
    expect(houseBal(kit)).toBe(18 * USDC);
    expect(kit.core.ledger.escrowOf(id)).toBe(2 * USDC);
    expect(m.price.yes).toBeCloseTo(0.77, 6);
    expect(lmsrWorstCaseLoss(m.prior, m.ammB!)).toBeLessThanOrEqual(2 * USDC);

    const buy = kit.core.placeBet(a, id, 'yes', 2 * USDC, T0) as { shares: string; cost: number };
    expect(buy.cost).toBeLessThanOrEqual(2 * USDC);
    expect(bal(kit, 0)).toBe(10 * USDC - buy.cost);
    expect(m.price.yes!).toBeGreaterThan(0.77);
    expect(m.price.yes! + m.price.no!).toBeCloseTo(1, 9);
    const pos = kit.core.positionsFor(a, id);
    expect(pos).toHaveLength(1);
    expect(pos[0]!.shares).toBe(buy.shares);
    expect(pos[0]!.stake).toBe(buy.cost);
    expect(pos[0]!.potential).toBe(Math.floor(Number(buy.shares) * USDC));

    // Buying by share count, then cashing out half and the rest.
    const buy2 = kit.core.ammTrade(b, id, 'no', 'buy', { shares: '2.5' }, T0) as { cost: number };
    expect(bal(kit, 1)).toBe(10 * USDC - buy2.cost);
    const sell1 = kit.core.ammTrade(b, id, 'no', 'sell', { shares: '1.25' }, T0) as { proceeds: number };
    const sell2 = kit.core.ammTrade(b, id, 'no', 'sell', { shares: 'all' }, T0) as { proceeds: number };
    expect(sell1.proceeds + sell2.proceeds).toBeLessThanOrEqual(buy2.cost); // rounding favours the house
    expect(buy2.cost - (sell1.proceeds + sell2.proceeds)).toBeLessThan(10);
    expect(kit.core.positionsFor(b, id)).toEqual([]);
    expect(code(() => kit.core.ammTrade(b, id, 'no', 'sell', { shares: 'all' }, T0))).toBe('bad_request');
    expect(code(() => kit.core.ammTrade(a, id, 'yes', 'sell', { shares: '999' }, T0))).toBe('insufficient_funds');
    expect(code(() => kit.core.ammTrade(a, id, 'yes', 'buy', {}, T0))).toBe('bad_request');
    expect(code(() => kit.core.ammTrade(a, id, 'yes', 'buy', { shares: '1', spend: USDC }, T0))).toBe('bad_request');
    kit.assertMoney();

    kit.core.resolveMarket(id, 'yes', T0);
    expect(bal(kit, 0)).toBe(10 * USDC - buy.cost + Math.floor(Number(buy.shares) * USDC));
    expect(kit.core.ledger.escrowOf(id)).toBe(0);
    kit.assertMoney();
    expect(bal(kit, 0) + bal(kit, 1) + bal(kit, 2) + houseBal(kit)).toBe(kit.total());
  });

  it('never costs the house more than its per-market budget', () => {
    const kit = makeKit({ players: 6 });
    const id = openMarket(kit, { mode: 'amm' });
    // Everyone piles the maximum onto the long shot, and it comes in.
    for (const p of kit.players) kit.core.placeBet(p.publicKey, id, 'no', 5 * USDC, T0);
    kit.core.resolveMarket(id, 'no', T0);
    expect(houseBal(kit)).toBeGreaterThanOrEqual(18 * USDC);
    expect(houseBal(kit)).toBeLessThan(20 * USDC);
    kit.assertMoney();
  });

  it('voids at cost: traders get their net cost back and the house its budget', () => {
    const kit = makeKit();
    const [a, b, c] = kit.players.map((p) => p.publicKey) as [string, string, string];
    const id = openMarket(kit, { mode: 'amm' });
    kit.core.placeBet(a, id, 'no', 1 * USDC, T0); // buys low
    kit.core.placeBet(b, id, 'no', 4 * USDC, T0); // pushes the price up
    kit.core.ammTrade(a, id, 'no', 'sell', { shares: 'all' }, T0); // cashes out at a profit
    kit.core.placeBet(c, id, 'yes', 2 * USDC, T0);
    expect(bal(kit, 0)).toBeGreaterThan(10 * USDC);
    kit.core.voidMarket(id, 'test', T0);
    expect(kit.core.rec(id).market.state).toBe('voided');
    // Every trade is undone, including the profit that was already cashed out.
    expect([bal(kit, 0), bal(kit, 1), bal(kit, 2)]).toEqual([10 * USDC, 10 * USDC, 10 * USDC]);
    expect(houseBal(kit)).toBe(20 * USDC);
    kit.assertMoney();
  });

  it('falls back to pool mode when the house cannot fund the market maker', () => {
    const kit = makeKit({ houseBudget: 0 });
    const m = kit.core.createMarket(binary({ mode: 'amm' }), T0);
    kit.core.openMarket(m.id, T0);
    expect(m.mode).toBe('pool');
    expect(m.pool).toEqual({ yes: 0, no: 0 });
    expect(kit.core.drainEffects().some((e) => e.t === 'note' && e.box)).toBe(true);
    kit.core.placeBet(kit.players[0]!.publicKey, m.id, 'yes', USDC, T0);
    kit.assertMoney();
  });

  it('lets the host switch the mode of a market that has no bets yet', () => {
    const kit = makeKit();
    const id = openMarket(kit, { mode: 'amm' });
    expect(houseBal(kit)).toBe(18 * USDC);
    kit.core.setMode('pool', id, T0);
    expect(kit.core.rec(id).market.mode).toBe('pool');
    expect(kit.core.rec(id).market.q).toBeUndefined();
    expect(houseBal(kit)).toBe(20 * USDC);
    kit.core.setMode('amm', id, T0);
    expect(houseBal(kit)).toBe(18 * USDC);
    kit.core.placeBet(kit.players[0]!.publicKey, id, 'yes', USDC, T0);
    expect(code(() => kit.core.setMode('bet', id, T0))).toBe('bad_request');
    kit.core.setMode('bet', undefined, T0);
    expect(kit.core.config.defaultMode).toBe('bet');
    kit.assertMoney();
  });
});

describe('bet (head-to-head) mode', () => {
  it('matches takers against an offer with partial fills and pays the winner both stakes', () => {
    const kit = makeKit();
    const [a, b, c] = kit.players.map((p) => p.publicKey) as [string, string, string];
    const id = openMarket(kit, { mode: 'bet' });
    const { offerId } = kit.core.postOffer(a, id, 'yes', 2 * USDC, 1.3, T0) as { offerId: string };
    expect(bal(kit, 0)).toBe(8 * USDC);
    expect(code(() => kit.core.takeOffer(a, offerId, USDC, T0))).toBe('bad_request'); // own offer
    const t1 = kit.core.takeOffer(b, offerId, 300_000, T0) as { takerStake: number; toWin: number };
    expect(t1).toEqual({ takerStake: 300_000, toWin: 1 * USDC });
    const t2 = kit.core.takeOffer(c, offerId, 5 * USDC, T0) as { takerStake: number; toWin: number };
    expect(t2).toEqual({ takerStake: 300_000, toWin: 1 * USDC }); // only what was left of the offer
    const offer = kit.core.offers.get(offerId)!;
    expect(offer.filled).toBe(2 * USDC);
    expect(offer.open).toBe(false);
    expect(code(() => kit.core.takeOffer(c, offerId, USDC, T0))).toBe('market_closed');
    expect(kit.core.ledger.escrowOf(id)).toBe(2_600_000);
    expect(kit.core.positionsFor(a, id)).toEqual([{ partyId: 'p1', marketId: id, player: a, outcome: 'yes', stake: 2 * USDC, potential: 2_600_000 }]);
    expect(kit.core.positionsFor(b, id)).toEqual([{ partyId: 'p1', marketId: id, player: b, outcome: 'no', stake: 300_000, potential: 1_300_000 }]);
    expect(kit.core.rec(id).market.price.yes).toBeCloseTo(1 / 1.3);
    kit.assertMoney();

    kit.core.resolveMarket(id, 'no', T0);
    expect([bal(kit, 0), bal(kit, 1), bal(kit, 2)]).toEqual([8 * USDC, 11 * USDC, 11 * USDC]);
    kit.assertMoney();
  });

  it('releases the unmatched part of an offer at lock', () => {
    const kit = makeKit();
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const id = openMarket(kit, { mode: 'bet' });
    const { offerId } = kit.core.postOffer(a, id, 'yes', 2 * USDC, 1.3, T0) as { offerId: string };
    kit.core.takeOffer(b, offerId, 300_000, T0);
    kit.core.lockMarket(id, T0);
    expect(bal(kit, 0)).toBe(9 * USDC);
    expect(kit.core.offers.get(offerId)!.open).toBe(false);
    expect(kit.core.ledger.escrowOf(id)).toBe(1_300_000);
    kit.core.resolveMarket(id, 'yes', T0);
    expect([bal(kit, 0), bal(kit, 1)]).toEqual([10_300_000, 9_700_000]);
    kit.assertMoney();
  });

  it('cancels offers for their maker only, and refunds both sides on void', () => {
    const kit = makeKit();
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const id = openMarket(kit, { mode: 'bet' });
    const o1 = (kit.core.postOffer(a, id, 'yes', 2 * USDC, 1.5, T0) as { offerId: string }).offerId;
    expect(code(() => kit.core.cancelOffer(b, o1, T0))).toBe('unauthorized');
    kit.core.takeOffer(b, o1, 500_000, T0); // matches 1 USDC of the maker's stake
    kit.core.cancelOffer(a, o1, T0);
    expect(bal(kit, 0)).toBe(9 * USDC);
    expect(code(() => kit.core.cancelOffer(a, o1, T0))).toBe('market_closed');
    const o2 = (kit.core.postOffer(a, id, 'no', 1 * USDC, 3, T0) as { offerId: string }).offerId;
    kit.core.voidMarket(id, 'ref was wrong', T0);
    expect(kit.core.offers.get(o2)!.open).toBe(false);
    expect([bal(kit, 0), bal(kit, 1)]).toEqual([10 * USDC, 10 * USDC]);
    expect(kit.core.ledger.escrowOf(id)).toBe(0);
    kit.assertMoney();
  });

  it('one-tap bets auto-match the best opposite offer and post the rest at the model odds (D10)', () => {
    const kit = makeKit();
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const id = openMarket(kit, { mode: 'bet' });
    const r1 = kit.core.placeBet(a, id, 'yes', 1 * USDC, T0) as { matched: number; posted: number; offerId: string };
    expect(r1.matched).toBe(0);
    expect(r1.posted).toBe(1 * USDC);
    expect(kit.core.offers.get(r1.offerId)!.odds).toBe(1.3); // 77% -> 1.30
    const nonceBefore = kit.core.ledger.accounts.get(b)!.nonce;
    const r2 = kit.core.placeBet(b, id, 'no', 1 * USDC, T0) as { matched: number; posted: number; offerId: string };
    expect(r2.matched).toBe(300_000); // all that the 1.30 offer can take
    expect(r2.posted).toBe(700_000);
    expect(kit.core.offers.get(r2.offerId)!.odds).toBe(4.35); // 23% -> 4.35
    expect(kit.core.offers.get(r1.offerId)!.open).toBe(false);
    // The match and the new offer are one atomic action: one new signed state.
    expect(kit.core.ledger.accounts.get(b)!.nonce).toBe(nonceBefore + 1);
    expect(kit.core.ledger.latest(b)!.state.entries.map((e) => e.type)).toEqual(['stake', 'offer_lock']);
    expect(bal(kit, 1)).toBe(9 * USDC);
    kit.assertMoney();
  });

  it('on categorical markets takers back "anything but" the maker side (D11)', () => {
    const kit = makeKit();
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const outcomes = [
      { id: 'home', label: 'Portugal' },
      { id: 'draw', label: 'Draw' },
      { id: 'away', label: 'Spain' },
    ];
    const id = openMarket(kit, { mode: 'bet', kind: 'game', outcomes, prior: { home: 0.42, draw: 0.27, away: 0.31 } });
    const { offerId } = kit.core.postOffer(a, id, 'home', 1 * USDC, 2, T0) as { offerId: string };
    kit.core.takeOffer(b, offerId, 1 * USDC, T0);
    expect(kit.core.positionsFor(b, id)[0]!.outcome).toBe('not:home');
    kit.core.resolveMarket(id, 'draw', T0);
    expect([bal(kit, 0), bal(kit, 1)]).toEqual([9 * USDC, 11 * USDC]);
    kit.assertMoney();
  });
});

describe('lifecycle', () => {
  it('runs draft -> open -> locked (countdown) -> resolved -> final with announcer events', () => {
    const kit = makeKit();
    const a = kit.players[0]!.publicKey;
    const m = kit.core.createMarket(binary({ mode: 'pool', lockAfterSecs: 20 }), T0);
    expect(m.state).toBe('draft');
    kit.core.openMarket(m.id, T0);
    expect(m.state).toBe('open');
    expect(m.lock.at).toBe(new Date(T0 + 20 * SEC).toISOString());
    expect(announced(kit.core.drainEffects())).toEqual(['market_opened']);
    kit.core.placeBet(a, m.id, 'yes', USDC, T0 + SEC);
    kit.core.drainEffects();

    kit.core.tick(T0 + 14 * SEC);
    expect(announced(kit.core.drainEffects())).toEqual([]);
    kit.core.tick(T0 + 15 * SEC);
    kit.core.tick(T0 + 16 * SEC);
    const soon = kit.core.drainEffects();
    expect(announced(soon)).toEqual(['lock_soon']); // once
    expect(soon.some((e) => e.t === 'led' && e.pattern === 'locking')).toBe(true);
    kit.core.tick(T0 + 20 * SEC);
    expect(m.state).toBe('locked');
    expect(m.roomProbAtLock).toEqual({ yes: 1, no: 0 });
    expect(announced(kit.core.drainEffects())).toEqual(['market_locked']);

    kit.core.resolveMarket(m.id, 'yes', T0 + 25 * SEC);
    expect(m.state).toBe('resolved');
    expect(m.disputeEndsAt).toBe(new Date(T0 + 45 * SEC).toISOString());
    const fx = kit.core.drainEffects();
    expect(announced(fx)).toContain('market_resolved');
    expect(fx.some((e) => e.t === 'scorecard')).toBe(true);
    kit.core.tick(T0 + 44 * SEC);
    expect(m.state).toBe('resolved');
    kit.core.tick(T0 + 45 * SEC);
    expect(m.state).toBe('final');
    expect(code(() => kit.core.resolveMarket(m.id, 'no', T0 + 50 * SEC))).toBe('market_closed');
    expect(code(() => kit.core.voidMarket(m.id, 'late', T0 + 50 * SEC))).toBe('market_closed');
    expect(kit.core.scorecard.n).toBe(1);
    expect(kit.core.scorecard.entries[0]).toMatchObject({ outcome: 'yes', room: 1, model: 0.77 });
  });

  it('resolving an open market locks it first (early result)', () => {
    const kit = makeKit();
    const id = openMarket(kit, { mode: 'pool' });
    kit.core.placeBet(kit.players[0]!.publicKey, id, 'yes', USDC, T0);
    kit.core.resolveMarket(id, 'yes', T0);
    const m = kit.core.rec(id).market;
    expect(m.state).toBe('resolved');
    expect(m.lockedAt).toBeDefined();
    expect(m.roomProbAtLock).toBeDefined();
  });

  it('holds drafts until approved and can discard them', () => {
    const kit = makeKit();
    const m = kit.core.createMarket(binary({ mode: 'pool' }), T0);
    kit.core.discardDraft(m.id);
    expect(m.state).toBe('discarded');
    expect(code(() => kit.core.openMarket(m.id, T0))).toBe('bad_request');
  });

  it('applies the moment-market rate limits (one per 20 s, at most 3 open)', () => {
    const kit = makeKit();
    expect(kit.core.momentAllowed(T0)).toBe(true);
    const ids = [openMarket(kit, { mode: 'pool' }, T0)];
    expect(kit.core.momentAllowed(T0 + 19 * SEC)).toBe(false);
    expect(kit.core.momentAllowed(T0 + 20 * SEC)).toBe(true);
    ids.push(openMarket(kit, { mode: 'pool' }, T0 + 20 * SEC));
    ids.push(openMarket(kit, { mode: 'pool' }, T0 + 40 * SEC));
    expect(kit.core.momentAllowed(T0 + 100 * SEC)).toBe(false); // three are open
    kit.core.lockMarket(ids[0]!, T0 + 100 * SEC);
    expect(kit.core.momentAllowed(T0 + 100 * SEC)).toBe(true);
    // Game-long markets never count against the limit.
    openMarket(kit, { mode: 'pool', kind: 'game' }, T0 + 100 * SEC);
    openMarket(kit, { mode: 'pool', kind: 'game' }, T0 + 100 * SEC);
    expect(kit.core.momentAllowed(T0 + 100 * SEC)).toBe(true);
  });

  it('picks the newest open moment market for the LOCK button', () => {
    const kit = makeKit();
    openMarket(kit, { mode: 'pool', kind: 'game' }, T0 + 5 * SEC);
    const m1 = openMarket(kit, { mode: 'pool' }, T0);
    const m2 = openMarket(kit, { mode: 'pool' }, T0 + 2 * SEC);
    expect(kit.core.newestOpen()!.id).toBe(m2);
    kit.core.lockMarket(m2, T0 + 3 * SEC);
    expect(kit.core.newestOpen()!.id).toBe(m1);
  });
});

describe('disputes', () => {
  it('a changed outcome reverses the old payout and applies the new one atomically', () => {
    const kit = makeKit();
    const [a, , c] = kit.players.map((p) => p.publicKey) as [string, string, string];
    const id = openMarket(kit, { mode: 'pool' });
    kit.core.placeBet(a, id, 'yes', 3 * USDC, T0);
    kit.core.placeBet(c, id, 'no', 2 * USDC, T0);
    kit.core.resolveMarket(id, 'yes', T0);
    expect([bal(kit, 0), bal(kit, 2)]).toEqual([12 * USDC, 8 * USDC]);
    const m = kit.core.rec(id).market;

    expect(code(() => kit.core.dispute('stranger', id, 'no way', T0 + SEC))).toBe('not_joined');
    kit.core.dispute(c, id, 'he missed!', T0 + SEC);
    expect(m.state).toBe('disputed');
    expect(m.dispute).toMatchObject({ by: c, reason: 'he missed!' });
    kit.core.tick(T0 + 60 * SEC); // a disputed market never finalizes by itself
    expect(m.state).toBe('disputed');

    const nonces = [a, c].map((p) => kit.core.ledger.accounts.get(p)!.nonce);
    kit.core.resolveMarket(id, 'no', T0 + 61 * SEC);
    expect(m.state).toBe('final');
    expect(m.outcome).toBe('no');
    expect([bal(kit, 0), bal(kit, 2)]).toEqual([7 * USDC, 13 * USDC]);
    // One adjusting state each, not a reversal plus a re-payment.
    expect([a, c].map((p) => kit.core.ledger.accounts.get(p)!.nonce)).toEqual(nonces.map((n) => n + 1));
    expect(kit.core.ledger.latest(a)!.state.entries).toMatchObject([{ type: 'adjust', amount: -5 * USDC }]);
    expect(kit.core.scorecard.entries).toMatchObject([{ marketId: id, outcome: 'no' }]);
    kit.assertMoney();
  });

  it('the host can confirm a disputed result, or void it (refund at cost)', () => {
    const kit = makeKit();
    const [a, , c] = kit.players.map((p) => p.publicKey) as [string, string, string];
    const id1 = openMarket(kit, { mode: 'pool' });
    kit.core.placeBet(a, id1, 'yes', 3 * USDC, T0);
    kit.core.placeBet(c, id1, 'no', 2 * USDC, T0);
    kit.core.resolveMarket(id1, 'yes', T0);
    kit.core.dispute(c, id1, '', T0);
    kit.core.confirmResult(id1);
    expect(kit.core.rec(id1).market.state).toBe('final');
    expect([bal(kit, 0), bal(kit, 2)]).toEqual([12 * USDC, 8 * USDC]);

    const id2 = openMarket(kit, { mode: 'amm', question: 'Second?' });
    kit.core.placeBet(a, id2, 'yes', 2 * USDC, T0);
    kit.core.placeBet(c, id2, 'no', 1 * USDC, T0);
    kit.core.resolveMarket(id2, 'yes', T0);
    kit.core.dispute(c, id2, 'wrong', T0);
    kit.core.voidMarket(id2, 'feed was wrong', T0);
    expect(kit.core.rec(id2).market.state).toBe('voided');
    expect(kit.core.rec(id2).market.outcome).toBeUndefined();
    expect([bal(kit, 0), bal(kit, 2)]).toEqual([12 * USDC, 8 * USDC]); // both trades undone
    expect(houseBal(kit)).toBe(20 * USDC);
    expect(kit.core.scorecard.entries.map((e) => e.marketId)).toEqual([id1]);
    kit.assertMoney();
  });

  it('rejects a dispute after the window', () => {
    const kit = makeKit();
    const a = kit.players[0]!.publicKey;
    const id = openMarket(kit, { mode: 'pool' });
    kit.core.placeBet(a, id, 'yes', USDC, T0);
    kit.core.resolveMarket(id, 'yes', T0);
    expect(code(() => kit.core.dispute(a, id, 'late', T0 + 21 * SEC))).toBe('market_closed');
    kit.core.tick(T0 + 21 * SEC);
    expect(code(() => kit.core.dispute(a, id, 'late', T0 + 22 * SEC))).toBe('market_closed');
  });

  it('when a winner has already spent the payout, the house covers the reversal and money is conserved', () => {
    const kit = makeKit();
    const [a, , c] = kit.players.map((p) => p.publicKey) as [string, string, string];
    const id = openMarket(kit, { mode: 'pool' });
    kit.core.placeBet(a, id, 'yes', 3 * USDC, T0);
    kit.core.placeBet(c, id, 'no', 2 * USDC, T0);
    kit.core.resolveMarket(id, 'yes', T0); // a: 12
    kit.core.dispute(c, id, 'wrong', T0);
    // a moves most of the balance into other markets before the host rules.
    const m2 = openMarket(kit, { mode: 'pool', question: 'Two?' });
    const m3 = openMarket(kit, { mode: 'pool', question: 'Three?' });
    kit.core.placeBet(a, m2, 'yes', 6 * USDC, T0); // a: 6
    kit.core.placeBet(a, m3, 'yes', 3 * USDC, T0); // a: 3
    kit.core.resolveMarket(id, 'no', T0); // a owes 5 but holds 3
    expect(bal(kit, 0)).toBe(0);
    expect(bal(kit, 2)).toBe(13 * USDC); // the rightful winner is paid in full
    expect(houseBal(kit)).toBe(18 * USDC); // the host backs the result it posted
    kit.assertMoney();
  });
});

describe('signed balances', () => {
  it('blocks new bets while an old state is un-countersigned (D6), unless member signatures are off', () => {
    const kit = makeKit();
    const a = kit.players[0]!.publicKey;
    const id = openMarket(kit, { mode: 'pool', kind: 'game' });
    expect(code(() => kit.core.placeBet(a, id, 'yes', USDC, T0 + 5 * SEC))).toBe('ok');
    expect(code(() => kit.core.placeBet(a, id, 'yes', USDC, T0 + 11 * SEC))).toBe('cosign_required');
    kit.cosignAll();
    expect(code(() => kit.core.placeBet(a, id, 'yes', USDC, T0 + 11 * SEC))).toBe('ok');
    expect(code(() => kit.core.placeBet(a, id, 'yes', USDC, T0 + 20 * SEC))).toBe('ok'); // 9 s old: still in grace
    expect(code(() => kit.core.placeBet(a, id, 'no', 100_000, T0 + 40 * SEC))).toBe('cosign_required');

    const trusted = makeKit({ config: { requireMemberSig: false } });
    const id2 = openMarket(trusted, { mode: 'pool', kind: 'game' });
    expect(code(() => trusted.core.placeBet(trusted.players[0]!.publicKey, id2, 'yes', USDC, T0 + 3600 * SEC))).toBe('ok');
  });

  it('every state a player receives passes the phone-side check, across all three modes', () => {
    const kit = makeKit({ config: { requireMemberSig: false } });
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const pool = openMarket(kit, { mode: 'pool' });
    const amm = openMarket(kit, { mode: 'amm', question: 'amm?' });
    const bet = openMarket(kit, { mode: 'bet', question: 'bet?' });
    kit.core.placeBet(a, pool, 'yes', USDC, T0);
    kit.core.placeBet(b, pool, 'no', USDC, T0);
    kit.core.placeBet(a, amm, 'yes', USDC, T0);
    kit.core.ammTrade(a, amm, 'yes', 'sell', { shares: 'all' }, T0);
    kit.core.placeBet(a, bet, 'yes', USDC, T0);
    kit.core.placeBet(b, bet, 'no', USDC, T0);
    kit.core.resolveMarket(pool, 'yes', T0);
    kit.core.voidMarket(amm, 'x', T0);
    kit.core.resolveMarket(bet, 'no', T0);
    for (const p of [a, b, kit.house.publicKey]) {
      let prev: BalanceState | null = null;
      for (const r of kit.core.ledger.accounts.get(p)!.records) {
        expect(checkBalanceState(r.state, kit.core.party.chain.partyAddress, kit.box.publicKey, prev)).toEqual({ ok: true });
        prev = r.state;
      }
    }
    kit.assertMoney();
  });

  it('credits a deposit exactly once per transaction signature', () => {
    const kit = makeKit();
    const a = kit.players[0]!.publicKey;
    expect(kit.core.creditDeposit(a, 5 * USDC, 'sig-1', T0)).toBe(true);
    expect(kit.core.creditDeposit(a, 5 * USDC, 'sig-1', T0)).toBe(false);
    expect(kit.core.creditDeposit(a, 5 * USDC, 'dep-0', T0)).toBe(false); // the original buy-in, seen again
    expect(bal(kit, 0)).toBe(15 * USDC);
    expect(kit.total()).toBe(20 * USDC + 3 * 10 * USDC + 5 * USDC);
    // A deposit from a wallet that never joined over WebSocket is still tracked.
    const external = generateKeyPair().publicKey;
    expect(kit.core.creditDeposit(external, 2 * USDC, 'sig-ext', T0)).toBe(true);
    expect(kit.core.members.get(external)).toMatchObject({ name: `Player ${external.slice(0, 4)}`, remote: true });
    expect(kit.core.ledger.balanceOf(external)).toBe(2 * USDC);
    // Garbage from a webhook changes nothing.
    const members = kit.core.members.size;
    expect(code(() => kit.core.creditDeposit('not-a-wallet', 2 * USDC, 'sig-bad', T0))).toBe('bad_request');
    expect(code(() => kit.core.creditDeposit(a, -5, 'sig-neg', T0))).toBe('bad_request');
    expect(kit.core.members.size).toBe(members);
    expect(kit.core.creditedDeposits.has('sig-bad')).toBe(false);
    kit.assertMoney();
  });
});

describe('voice drafts', () => {
  it('a draft moves no money until the player confirms it', () => {
    const kit = makeKit();
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const id = openMarket(kit, { mode: 'pool' });
    const nonce = kit.core.ledger.accounts.get(a)!.nonce;
    const d = kit.core.addDraft(a, id, 'Yes', 2 * USDC, 'voice', T0);
    expect(d).toMatchObject({ player: a, marketId: id, outcome: 'yes', amount: 2 * USDC, source: 'voice' });
    expect(bal(kit, 0)).toBe(10 * USDC);
    expect(kit.core.ledger.accounts.get(a)!.nonce).toBe(nonce);
    expect(code(() => kit.core.confirmDraft(b, d.id, T0))).toBe('not_found'); // not their draft
    kit.core.confirmDraft(a, d.id, T0 + SEC);
    expect(bal(kit, 0)).toBe(8 * USDC);
    expect(kit.core.draftsFor(a)).toEqual([]);
    expect(code(() => kit.core.confirmDraft(a, d.id, T0))).toBe('not_found');
  });

  it('drafts can be rejected, expire after 60 s, and still obey the stake limits', () => {
    const kit = makeKit();
    const a = kit.players[0]!.publicKey;
    const id = openMarket(kit, { mode: 'pool', kind: 'game' });
    const d1 = kit.core.addDraft(a, id, 'no', USDC, 'voice', T0);
    kit.core.rejectDraft(a, d1.id);
    expect(kit.core.draftsFor(a)).toEqual([]);
    const d2 = kit.core.addDraft(a, id, 'no', USDC, 'voice', T0);
    kit.core.tick(T0 + 59 * SEC);
    expect(kit.core.draftsFor(a)).toHaveLength(1);
    kit.core.tick(T0 + 60 * SEC);
    expect(kit.core.draftsFor(a)).toEqual([]);
    expect(code(() => kit.core.confirmDraft(a, d2.id, T0 + 61 * SEC))).toBe('not_found');
    const big = kit.core.addDraft(a, id, 'no', 9 * USDC, 'voice', T0);
    expect(code(() => kit.core.confirmDraft(a, big.id, T0))).toBe('stake_limit');
    expect(bal(kit, 0)).toBe(10 * USDC);
    expect(code(() => kit.core.addDraft(a, id, 'banana', USDC, 'voice', T0))).toBe('bad_request');
  });
});

describe('scorecard', () => {
  it('records room, model and Gemini probabilities for the outcome that happened', () => {
    const kit = makeKit();
    const a = kit.players[0]!.publicKey;
    const ref = { eventTicker: 'E', contractTicker: 'E-YES', prob: 0.7, asOf: new Date(T0).toISOString(), outcomeId: 'yes' };
    const m1 = openMarket(kit, { mode: 'pool', geminiRef: ref });
    kit.core.placeBet(a, m1, 'yes', USDC, T0);
    kit.core.resolveMarket(m1, 'yes', T0);
    const m2 = openMarket(kit, { mode: 'pool', question: 'Other side?', geminiRef: ref });
    kit.core.resolveMarket(m2, 'no', T0);
    const outcomes = [
      { id: 'home', label: 'Portugal' },
      { id: 'draw', label: 'Draw' },
      { id: 'away', label: 'Spain' },
    ];
    const m3 = openMarket(kit, {
      mode: 'pool',
      kind: 'game',
      question: 'Winner?',
      outcomes,
      prior: { home: 0.42, draw: 0.27, away: 0.31 },
      geminiRef: { ...ref, outcomeId: 'home', prob: 0.46 },
    });
    kit.core.resolveMarket(m3, 'away', T0);
    const m4 = openMarket(kit, { mode: 'pool', question: 'No ref?' });
    kit.core.resolveMarket(m4, 'yes', T0);

    const byId = new Map(kit.core.scorecard.entries.map((e) => [e.marketId, e]));
    expect(byId.get(m1)).toMatchObject({ room: 1, model: 0.77, gemini: 0.7 });
    expect(byId.get(m2)!.gemini).toBeCloseTo(0.3); // other side of a binary market
    expect(byId.get(m2)!.room).toBeCloseTo(0.23); // empty pool: the room price is the prior
    expect(byId.get(m3)!.gemini).toBeUndefined(); // not comparable on a 3-way market
    expect(byId.get(m3)!.model).toBeCloseTo(0.31);
    expect(byId.get(m4)!.gemini).toBeUndefined();
    expect(kit.core.scorecard.n).toBe(4);
    expect(kit.core.scorecard.nGemini).toBe(2);
    expect(kit.core.scorecard.brier.gemini).toBeCloseTo((0.3 ** 2 + 0.7 ** 2) / 2);
  });
});

describe('leaderboard', () => {
  it('reports balance, locked stake and profit, and announces a new leader', () => {
    const kit = makeKit();
    const [a, b] = kit.players.map((p) => p.publicKey) as [string, string];
    const id = openMarket(kit, { mode: 'amm' });
    kit.core.placeBet(a, id, 'yes', 2 * USDC, T0);
    kit.core.placeBet(b, id, 'no', 1 * USDC, T0);
    const before = new Map(kit.core.players().map((p) => [p.pubkey, p]));
    expect(before.get(a)!.locked).toBe(10 * USDC - bal(kit, 0));
    expect(before.get(a)!.pnl).toBe(0);
    expect(before.get(kit.house.publicKey)).toMatchObject({ isHouse: true, locked: 2 * USDC, pnl: 0 });
    // What is in play plus what is in hand always adds up to the deposits.
    expect(kit.core.players().reduce((s, p) => s + p.balance + p.locked, 0)).toBe(kit.total());
    kit.core.drainEffects();
    kit.core.resolveMarket(id, 'yes', T0);
    const fx = kit.core.drainEffects();
    const leader = fx.find((e) => e.t === 'announce' && e.event.type === 'leaderboard_change');
    expect(leader).toMatchObject({ event: { leader: 'Ayan' } });
    const players = kit.core.players();
    expect(players[0]!.pubkey).toBe(a);
    expect(players[0]!.streak).toBe(1);
    expect(players.at(-1)!.isHouse).toBe(true);
    expect(players.find((p) => p.pubkey === b)!.streak).toBe(-1);
    expect(players.reduce((s, p) => s + p.pnl, 0)).toBe(0); // zero-sum
  });
});

describe('random play conserves money', () => {
  it('1000 random actions across all three modes, then settle everything', () => {
    let seed = 20261116;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const kit = makeKit({ players: 6, config: { requireMemberSig: false }, houseBudget: 10 * USDC });
    const { core } = kit;
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const modes = ['pool', 'amm', 'bet'] as const;
    const outcomes3 = [
      { id: 'home', label: 'Home' },
      { id: 'draw', label: 'Draw' },
      { id: 'away', label: 'Away' },
    ];
    let now = T0;
    let engineErrors = 0;
    const attempt = (fn: () => unknown): void => {
      try {
        fn();
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        engineErrors++;
      }
      kit.assertMoney();
    };
    for (let i = 0; i < 1000; i++) {
      now += 500;
      const live = [...core.markets.values()].map((r) => r.market);
      const open = live.filter((m) => m.state === 'open');
      const r = rnd();
      if (open.length < 3 || r < 0.05) {
        const three = rnd() < 0.3;
        attempt(() =>
          openMarket(
            kit,
            three
              ? { mode: pick([...modes]), kind: 'game', outcomes: outcomes3, prior: { home: 0.5, draw: 0.2, away: 0.3 }, question: `q${i}` }
              : { mode: pick([...modes]), outcomes: YES_NO, prior: { yes: 0.3 + rnd() * 0.5, no: 0.2 }, question: `q${i}` },
            now,
          ),
        );
        continue;
      }
      const m = pick(open);
      const p = pick(kit.players).publicKey;
      const o = pick(m.outcomes).id;
      const amt = 100_000 + Math.floor(rnd() * 3 * USDC);
      if (r < 0.8) {
        const t = rnd();
        if (m.mode === 'pool') attempt(() => core.placeBet(p, m.id, o, amt, now));
        else if (m.mode === 'amm') {
          if (t < 0.4) attempt(() => core.placeBet(p, m.id, o, amt, now));
          else if (t < 0.6) attempt(() => core.ammTrade(p, m.id, o, 'buy', { shares: (0.5 + rnd() * 3).toFixed(6) }, now));
          else attempt(() => core.ammTrade(p, m.id, o, 'sell', { shares: rnd() < 0.5 ? 'all' : (rnd() * 2).toFixed(6) }, now));
        } else {
          const offers = [...core.offers.values()].filter((x) => x.open && x.marketId === m.id);
          if (t < 0.35) attempt(() => core.placeBet(p, m.id, o, amt, now));
          else if (t < 0.6 || offers.length === 0) attempt(() => core.postOffer(p, m.id, o, amt, 1.05 + rnd() * 4, now));
          else if (t < 0.9) attempt(() => core.takeOffer(p, pick(offers).id, amt, now));
          else {
            const offer = pick(offers);
            attempt(() => core.cancelOffer(offer.maker, offer.id, now));
          }
        }
      } else if (r < 0.86) attempt(() => core.lockMarket(m.id, now));
      else if (r < 0.94) attempt(() => core.resolveMarket(m.id, o, now));
      else if (r < 0.97) attempt(() => core.voidMarket(m.id, 'random', now));
      else {
        const resolved = live.filter((x) => x.state === 'resolved');
        if (resolved.length) {
          const d = pick(resolved);
          attempt(() => core.dispute(p, d.id, 'random', now));
          attempt(() => (rnd() < 0.5 ? core.resolveMarket(d.id, pick(d.outcomes).id, now) : core.voidMarket(d.id, 'disputed', now)));
        }
      }
      if (i % 25 === 0) attempt(() => core.tick(now));
    }
    expect(core.markets.size).toBeGreaterThan(20);
    expect(core.fills.length).toBe(50);
    // End of game: whatever is unresolved is voided at cost.
    for (const { market } of core.markets.values()) {
      if (market.state === 'open' || market.state === 'locked' || market.state === 'disputed') core.voidMarket(market.id, 'end', now);
    }
    core.tick(now + 3600 * SEC);
    for (const { market } of core.markets.values()) expect(['final', 'voided']).toContain(market.state);
    expect(core.ledger.sumEscrow()).toBe(0);
    expect(core.ledger.sumBalances()).toBe(kit.total());
    expect(core.players().reduce((s, p) => s + p.pnl, 0)).toBe(0);
    for (const p of core.players()) expect(p.locked).toBe(0);
    expect(engineErrors).toBeGreaterThan(0); // limits did bite along the way
    expect(core.ledger.invariantChecks).toBeGreaterThan(300);
    // And every state is still a valid, checkable chain.
    for (const [pubkey, acct] of core.ledger.accounts) {
      let prev: BalanceState | null = null;
      for (const rec of acct.records) {
        expect(checkBalanceState(rec.state, core.party.chain.partyAddress, kit.box.publicKey, prev)).toEqual({ ok: true });
        prev = rec.state;
      }
      expect(prev?.balance ?? 0).toBe(core.ledger.balanceOf(pubkey));
    }
  });
});
