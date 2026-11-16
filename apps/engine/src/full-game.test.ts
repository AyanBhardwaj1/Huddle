import { USDC, checkBalanceState, type BalanceState, type MarketMode } from '@huddle/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { runBots, type BotsHandle } from './bots';
import { startTestEngine, waitUntil, type Harness } from './test-harness';

/**
 * The A2 "done when": a scripted party with 5 bot players plays a full replay in each of the three
 * modes; the ledger total always equals the deposits; everything settles and pays out.
 */

let h: Harness | null = null;
let bots: BotsHandle | null = null;

afterEach(async () => {
  bots?.close();
  bots = null;
  await h?.close();
  h = null;
});

async function playFullGame(mode: MarketMode) {
  h = await startTestEngine();
  const { party, hostToken, rt } = await h.createParty({ defaultMode: mode, buyIn: 10, houseBudget: 20 });
  expect(party.config.settlement).toBe('points');
  expect(party.config.defaultMode).toBe(mode);
  const box = await h.box(party.code, hostToken);
  bots = await runBots({ url: h.url, partyCode: party.code, n: 5, intervalMs: 35, seed: 42 });
  const deposits = 5 * 10 * USDC + 20 * USDC;
  expect(rt.core.ledger.totalDeposits).toBe(deposits);

  // Sample the money invariant all the way through (the ledger also asserts it on every commit).
  let samples = 0;
  let broken = 0;
  const statuses = new Set<string>([rt.status]);
  const sampler = setInterval(() => {
    samples++;
    statuses.add(rt.status);
    const c = rt.core.ledger.checkInvariant();
    if (!c.ok || c.deposits !== deposits) broken++;
  }, 5);

  await h.host(box, { action: 'set_speed', speed: 20 });
  await h.host(box, { action: 'start_game' });
  await waitUntil(() => rt.status === 'finalized', 30_000, 'the party to finalize');
  clearInterval(sampler);
  await bots.done;
  return { h, rt, box, party, bots, deposits, samples, broken, statuses };
}

function assertSettled(r: Awaited<ReturnType<typeof playFullGame>>): void {
  const { rt, bots: b, deposits, h: harness } = r;
  const core = rt.core;

  // Money: invariant at every step, nothing left in escrow, nothing created or destroyed.
  expect(r.broken).toBe(0);
  expect(r.samples).toBeGreaterThan(50);
  expect(rt.internalErrors).toBe(0);
  expect(core.ledger.invariantChecks).toBeGreaterThan(20);
  expect(core.ledger.sumEscrow()).toBe(0);
  expect(core.ledger.sumBalances()).toBe(deposits);

  // Every market ended final or voided; the mock game resolves all three.
  const markets = [...core.markets.values()].map((x) => x.market);
  expect(markets.length).toBe(3);
  for (const m of markets) expect(['final', 'voided']).toContain(m.state);
  expect(markets.filter((m) => m.state === 'final').length).toBe(3);
  expect(markets.find((m) => m.templateId === 'soccer.penalty')).toMatchObject({ outcome: 'yes', kind: 'moment' });
  expect(markets.find((m) => m.templateId === 'soccer.winner')).toMatchObject({ outcome: 'home' });
  expect(markets.find((m) => m.templateId === 'soccer.total_goals')).toMatchObject({ outcome: 'yes' });

  // Every bot countersigned its final state, and the whole chain of states checks out.
  for (const bot of b.bots) {
    const acct = core.ledger.accounts.get(bot.keyPair.publicKey)!;
    expect(core.ledger.unsigned(bot.keyPair.publicKey)).toEqual([]);
    expect(acct.records.at(-1)!.state.memberSig).toBeDefined();
    expect(acct.records.every((x) => x.state.memberSig)).toBe(true);
    let prev: BalanceState | null = null;
    for (const rec of acct.records) {
      expect(checkBalanceState(rec.state, core.party.chain.partyAddress, core.party.boxSigner, prev)).toEqual({ ok: true });
      prev = rec.state;
    }
    const view = bot.client.getView();
    expect(view.cosignMismatch).toBeNull();
    expect(view.lastSigned?.nonce).toBe(acct.nonce);
    expect(view.snapshot?.party.status).toBe('finalized');
  }

  // Final payouts sum to the total deposits and match each final signed balance.
  const players = core.players();
  expect(players).toHaveLength(6);
  expect(players.reduce((s, p) => s + (p.payout ?? 0), 0)).toBe(deposits);
  for (const p of players) {
    expect(p.payout).toBe(p.balance);
    expect(p.locked).toBe(0);
    expect(p.withdrawTx).toBeDefined();
  }
  expect(players.reduce((s, p) => s + p.pnl, 0)).toBe(0);
  // The bots saw the same payouts over the wire.
  const seen = b.bots[0]!.client.getView().snapshot!.players;
  expect(seen.reduce((s, p) => s + (p.payout ?? 0), 0)).toBe(deposits);

  // Scorecard, lifecycle, announcer and LEDs.
  expect(core.scorecard.n).toBe(3);
  expect(core.scorecard.entries.every((e) => e.room >= 0 && e.room <= 1 && e.model > 0)).toBe(true);
  expect(core.scorecard.nGemini).toBe(1); // the match-winner market has a Gemini moneyline
  expect([...r.statuses]).toEqual(expect.arrayContaining(['lobby', 'live']));
  expect(core.party.chain.closeTx).toBeDefined();
  expect(core.party.chain.finalizeTx).toBeDefined();
  const said = harness.announcer.types();
  for (const t of ['player_joined', 'market_opened', 'market_locked', 'market_resolved', 'game_recap']) expect(said).toContain(t);
  const leds = harness.bridge.commands.flatMap((c) => (c.type === 'led' ? [c.pattern] : []));
  for (const p of ['join', 'market_open', 'locked', 'goal', 'idle']) expect(leds).toContain(p);
  expect(leds.some((p) => p === 'win' || p === 'loss')).toBe(true);

  // Bots really played, and nothing they sent was refused for a reason other than normal races.
  expect(b.stats.accepted).toBeGreaterThan(20);
  for (const bad of ['internal', 'cosign_required', 'unauthorized', 'not_joined', 'bad_request', 'network']) {
    expect(b.stats.rejected[bad] ?? 0, `bots hit ${bad}: ${JSON.stringify(b.stats)}`).toBe(0);
  }
}

describe('a 5-bot party through a full replayed game', () => {
  it('pool mode', async () => {
    const r = await playFullGame('pool');
    assertSettled(r);
    const markets = [...r.rt.core.markets.values()].map((x) => x.market);
    expect(markets.every((m) => m.mode === 'pool')).toBe(true);
    expect(r.bots.stats.byKind.pool_bet ?? 0).toBeGreaterThan(20);
    expect(markets.every((m) => m.volume > 0)).toBe(true);
    // No market maker in pool mode: the house only ever collects rounding dust.
    const house = r.rt.core.players().find((p) => p.isHouse)!;
    expect(house.pnl).toBeGreaterThanOrEqual(0);
    expect(house.pnl).toBeLessThan(100);
  });

  it('market (AMM) mode, including cash-outs', async () => {
    const r = await playFullGame('amm');
    assertSettled(r);
    const markets = [...r.rt.core.markets.values()].map((x) => x.market);
    expect(markets.every((m) => m.mode === 'amm')).toBe(true);
    const k = r.bots.stats.byKind;
    expect((k.amm_bet ?? 0) + (k.amm_buy_spend ?? 0) + (k.amm_buy_shares ?? 0)).toBeGreaterThan(10);
    expect(k.amm_sell ?? 0).toBeGreaterThan(0);
    // The market maker can lose at most its budget per market (3 markets x 2 USDC).
    const house = r.rt.core.players().find((p) => p.isHouse)!;
    expect(house.pnl).toBeGreaterThanOrEqual(-6 * USDC);
    // Prices moved away from the model prior in at least one market.
    expect(markets.some((m) => Math.abs((m.roomProbAtLock?.[m.outcomes[0]!.id] ?? 0) - m.prior[m.outcomes[0]!.id]!) > 0.01)).toBe(true);
  });

  it('bet (head-to-head) mode, including taking offers', async () => {
    const r = await playFullGame('bet');
    assertSettled(r);
    const core = r.rt.core;
    const markets = [...core.markets.values()].map((x) => x.market);
    expect(markets.every((m) => m.mode === 'bet')).toBe(true);
    const k = r.bots.stats.byKind;
    expect((k.post_offer ?? 0) + (k.bet_one_tap ?? 0)).toBeGreaterThan(5);
    expect(k.take_offer ?? 0).toBeGreaterThan(0);
    // Offers were matched into pairs, and every offer is closed at the end.
    expect([...core.markets.values()].reduce((s, x) => s + x.book.pairs.length, 0)).toBeGreaterThan(0);
    expect([...core.offers.values()].every((o) => !o.open)).toBe(true);
    // Head-to-head has no house: its balance is untouched.
    expect(core.players().find((p) => p.isHouse)!.pnl).toBe(0);
  });
});
