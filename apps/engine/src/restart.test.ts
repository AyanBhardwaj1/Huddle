import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { USDC, checkBalanceState, generateKeyPair, type BalanceState } from '@huddle/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { PartyRuntime } from './party';
import { TEST_ENV, startTestEngine, waitUntil, type Harness, type TestPlayer } from './test-harness';

/** PRD section 13: the engine restarts without losing state (SQLite, WAL). */

let dir = '';
let open: Harness | null = null;

afterEach(async () => {
  await open?.close();
  open = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** Everything that must survive a restart, in a comparable shape. */
function fingerprint(rt: PartyRuntime) {
  const core = rt.core;
  return {
    status: core.party.status,
    party: core.party,
    totalDeposits: core.ledger.totalDeposits,
    accounts: [...core.ledger.accounts.values()]
      .map((a) => ({
        pubkey: a.pubkey,
        balance: a.balance,
        deposited: a.deposited,
        nonce: a.nonce,
        stateHash: a.stateHash,
        entrySeq: a.entrySeq,
        states: a.records.map((r) => r.state),
      }))
      .sort((x, y) => x.pubkey.localeCompare(y.pubkey)),
    escrow: [...core.ledger.escrow].filter(([, v]) => v !== 0).sort(([x], [y]) => x.localeCompare(y)),
    markets: [...core.markets.values()].map((r) => r.market),
    books: [...core.markets.values()].map((r) => r.book),
    offers: [...core.offers.values()].sort((x, y) => x.id.localeCompare(y.id)),
    positions: [...core.members.keys()].sort().map((p) => core.positionsFor(p)),
    members: [...core.members.values()].sort((x, y) => x.pubkey.localeCompare(y.pubkey)),
    fills: core.fills,
    scorecard: core.scorecard,
    game: rt.game,
    lastSeq: rt.lastSeq,
  };
}

describe('restart', () => {
  it('restores balances, nonces, signatures and open markets mid-party, then finishes the game', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-restart-'));

    // ── First run: a party in progress ──
    // Drafts normally expire after 60 s (3 s at 20x); keep them long enough to survive the restart below.
    const opts = { dataDir: dir, timing: { core: { draftTtlMs: 12_000_000 } } };
    let h = (open = await startTestEngine(opts));
    const created = await h.createParty({ defaultMode: 'amm', buyIn: 10, houseBudget: 20 });
    const { party, hostToken } = created;
    let rt = created.rt;
    let box = await h.box(party.code, hostToken);
    const first: TestPlayer[] = [];
    for (const name of ['Ayan', 'Jake', 'Priya']) first.push(await h.player(party.code, name, { buyIn: 10 * USDC }));
    const [a, b, c] = first as [TestPlayer, TestPlayer, TestPlayer];

    await h.host(box, { action: 'set_speed', speed: 20 });
    await h.host(box, { action: 'start_game' });
    await waitUntil(() => rt.core.markets.size === 2 && rt.game.status === 'live', 5000, 'kickoff markets');
    await h.host(box, { action: 'pause_game' });
    expect(rt.lastSeq).toBe(1);
    const kickoff = [...rt.core.markets.values()].map((r) => r.market);
    const goals = kickoff.find((m) => m.templateId === 'soccer.total_goals');
    const winner = kickoff.find((m) => m.templateId === 'soccer.winner');
    expect([goals!.mode, winner!.mode, goals!.state, winner!.state]).toEqual(['amm', 'amm', 'open', 'open']);
    const pool = (await h.host(box, { action: 'create_market', question: 'Pool one?', outcomes: ['Yes', 'No'], mode: 'pool' })).marketId as string;
    const bet = (await h.host(box, { action: 'create_market', question: 'Head to head?', outcomes: ['Yes', 'No'], mode: 'bet' })).marketId as string;

    await a.client.request({ type: 'place_bet', marketId: goals!.id, outcome: 'yes', stake: 2 * USDC });
    await b.client.request({ type: 'amm_trade', marketId: winner!.id, outcome: 'away', side: 'buy', spend: 1 * USDC });
    await b.client.request({ type: 'amm_trade', marketId: winner!.id, outcome: 'away', side: 'sell', shares: '0.5' });
    await b.client.request({ type: 'place_bet', marketId: pool, outcome: 'no', stake: 1 * USDC });
    await c.client.request({ type: 'place_bet', marketId: pool, outcome: 'yes', stake: 3 * USDC });
    const offer = (await a.client.request({ type: 'post_offer', marketId: bet, side: 'yes', makerStake: 2 * USDC, odds: 1.5 })).offerId as string;
    await c.client.request({ type: 'take_offer', offerId: offer, amount: 500_000 }); // half matched, half still open
    await c.client.request({ type: 'talk_text', text: '1 on Draw' }); // the mock announcer drafts on the first open market
    await waitUntil(() => rt.core.drafts.size === 1, 3000, 'a voice draft');
    // One resolved market so there is a scorecard entry and a payout in the history.
    const quick = (await h.host(box, { action: 'create_market', question: 'Quick one?', outcomes: ['Yes', 'No'], mode: 'pool' })).marketId as string;
    await a.client.request({ type: 'place_bet', marketId: quick, outcome: 'yes', stake: 1 * USDC });
    await b.client.request({ type: 'place_bet', marketId: quick, outcome: 'no', stake: 1 * USDC });
    await h.host(box, { action: 'resolve', marketId: quick, outcome: 'yes' });
    await h.host(box, { action: 'confirm_result', marketId: quick });
    await waitUntil(() => first.every((p) => rt.core.ledger.unsigned(p.pubkey).length === 0), 5000, 'countersignatures');

    const before = fingerprint(rt);
    const lastSigned = first.map((p) => p.client.getView().lastSigned);
    const position = rt.feed!.control!.status().positionMs;
    expect(before.status).toBe('live');
    expect(before.escrow.length).toBe(4);
    expect(before.offers.find((o) => o.id === offer)).toMatchObject({ open: true, filled: 1 * USDC });
    expect(before.scorecard.n).toBe(1);
    expect(before.accounts.every((x) => x.states.every((s) => s.memberSig))).toBe(true);
    const store = h.handle.engine.store;
    expect(store.count('parties')).toBe(1);
    expect(store.count('members')).toBe(4);
    expect(store.count('markets')).toBe(5);
    expect(store.count('offers')).toBe(1);
    expect(store.count('drafts')).toBe(1);
    expect(store.count('scorecard_entries')).toBe(1);
    expect(store.count('deposits')).toBe(4);
    expect(store.count('positions')).toBeGreaterThanOrEqual(6);
    expect(store.count('balance_states')).toBe(before.accounts.reduce((s, x) => s + x.nonce, 0));
    expect(store.count('ledger_entries')).toBe(before.accounts.reduce((s, x) => s + x.entrySeq, 0));
    await h.close();

    // Secrets: key files are private, and neither keys nor the host token are in the database.
    const keys = fs.readdirSync(path.join(dir, 'keys'));
    expect(keys).toEqual(expect.arrayContaining(['box-signer.json', `house-${party.id}.json`]));
    for (const f of keys) expect(fs.statSync(path.join(dir, 'keys', f)).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(dir, 'keys')).mode & 0o077).toBe(0);
    const dbBytes = Buffer.concat(
      fs
        .readdirSync(dir)
        .filter((f) => f.startsWith('huddle.sqlite'))
        .map((f) => fs.readFileSync(path.join(dir, f))),
    ).toString('latin1');
    expect(dbBytes).toContain(party.code);
    expect(dbBytes).not.toContain(hostToken);
    const houseSecret = fs.readFileSync(path.join(dir, 'keys', `house-${party.id}.json`), 'utf8');
    expect(dbBytes).not.toContain(houseSecret);

    // ── Second run: same data directory, brand-new process state (the mock vault has forgotten everything) ──
    h = open = await startTestEngine(opts);
    rt = h.handle.engine.party(party.code)!;
    expect(rt).toBeDefined();
    const after = fingerprint(rt);
    expect(after).toEqual(before);
    expect(rt.core.ledger.checkInvariant()).toMatchObject({ ok: true, deposits: 50 * USDC });
    expect(rt.internalErrors).toBe(0);
    expect(rt.core.drafts.size).toBe(1);
    // The feed is reopened paused where the game was.
    const replay = rt.feed!.control!.status();
    expect(replay).toMatchObject({ playing: false, speed: 20 });
    expect(Math.abs(replay.positionMs - position)).toBeLessThan(1500);
    expect((await h.get(`/parties/${party.code}`)).json).toMatchObject({ party: { status: 'live' }, game: { status: 'live', lastSeq: 1 } });
    // Every restored state is still a valid signed chain under the same box key.
    for (const acct of rt.core.ledger.accounts.values()) {
      let prev: BalanceState | null = null;
      for (const rec of acct.records) {
        expect(checkBalanceState(rec.state, party.chain.partyAddress, party.boxSigner, prev)).toEqual({ ok: true });
        prev = rec.state;
      }
    }

    // The host token still works (and only the right one); phones pick up where they left off.
    await expect(h.box(party.code, 'wrong-token')).rejects.toThrow();
    box = await h.box(party.code, hostToken);
    const second: TestPlayer[] = [];
    for (const [i, p] of first.entries()) {
      second.push(await h.player(party.code, p.name, { keyPair: p.keyPair, lastSigned: lastSigned[i]! }));
    }
    const [a2, b2, c2] = second as [TestPlayer, TestPlayer, TestPlayer];
    expect(second.map((p) => p.balance())).toEqual(first.map((p) => before.accounts.find((x) => x.pubkey === p.pubkey)!.balance));
    // Ayan still holds the AMM shares and the matched half of the head-to-head offer.
    expect(a2.client.getView().snapshot!.you!.positions.map((p) => p.marketId).sort()).toEqual([goals!.id, bet].sort());
    expect(a2.client.getView().snapshot!.you!.positions.find((p) => p.marketId === bet)).toMatchObject({ outcome: 'yes', stake: 1 * USDC, potential: 1_500_000 });
    expect(a2.client.getView().snapshot!.offers.find((o) => o.id === offer)).toMatchObject({ open: true, filled: 1 * USDC });
    expect(c2.client.getView().snapshot!.you!.drafts.length).toBe(1);
    expect(a2.client.getView().snapshot!.markets.filter((m) => m.state === 'open').length).toBe(4);

    // Trading continues on the restored books with the next nonce.
    const nonce = rt.core.ledger.accounts.get(b2.pubkey)!.nonce;
    await b2.client.request({ type: 'take_offer', offerId: offer, amount: 500_000 }); // the other half of the offer
    expect(rt.core.offers.get(offer)).toMatchObject({ open: false, filled: 2 * USDC });
    await b2.client.request({ type: 'amm_trade', marketId: winner!.id, outcome: 'away', side: 'sell', shares: 'all' });
    expect(rt.core.ledger.accounts.get(b2.pubkey)!.nonce).toBe(nonce + 2);
    await h.host(box, { action: 'resolve', marketId: pool, outcome: 'yes' });
    await waitUntil(() => second.every((p) => rt.core.ledger.unsigned(p.pubkey).length === 0), 5000, 'countersignatures after restart');
    expect(second.every((p) => p.client.getView().cosignMismatch === null)).toBe(true);
    expect(rt.core.ledger.checkInvariant().ok).toBe(true);

    // Play the rest of the game. No event is applied twice; everything settles and pays out.
    await h.host(box, { action: 'start_game' });
    await waitUntil(() => rt.status === 'finalized', 30_000, 'the restored party to finalize');
    expect(rt.internalErrors).toBe(0);
    expect(rt.lastSeq).toBe(11);
    expect(rt.game.score).toEqual({ home: 2, away: 1 });
    const markets = [...rt.core.markets.values()].map((r) => r.market);
    expect(markets.map((m) => m.state).sort()).toEqual(['final', 'final', 'final', 'final', 'final', 'voided']); // the bet market had no result
    expect(markets.filter((m) => m.templateId === 'soccer.penalty')).toMatchObject([{ state: 'final', outcome: 'yes' }]);
    expect(rt.core.ledger.sumEscrow()).toBe(0);
    expect(rt.core.ledger.sumBalances()).toBe(50 * USDC);
    const players = rt.core.players();
    expect(players.reduce((s, p) => s + (p.payout ?? 0), 0)).toBe(50 * USDC);
    for (const p of players) expect(p.payout).toBe(p.balance);
    for (const p of second) expect(rt.core.ledger.unsigned(p.pubkey)).toEqual([]);
    const final = fingerprint(rt);
    await h.close();

    // ── Third run: the finished party is still readable, and stays finished ──
    h = open = await startTestEngine(opts);
    const done = h.handle.engine.party(party.code)!;
    expect(done.status).toBe('finalized');
    expect(fingerprint(done).accounts).toEqual(final.accounts);
    expect(done.core.players().map((p) => p.payout)).toEqual(players.map((p) => p.payout));
    expect((await h.get('/parties')).json.parties).toEqual([]);
    expect(((await h.get(`/parties/${party.code}`)).json.party as { status: string }).status).toBe('finalized');
    expect(h.handle.engine.store.count('parties')).toBe(1);
    await h.close();

    // ── A different box key must never adopt a party it did not sign ──
    const other = JSON.stringify(Array.from(generateKeyPair().secretKey));
    h = open = await startTestEngine({ dataDir: dir, env: { ...TEST_ENV, BOX_SIGNER_SECRET_KEY: other } });
    expect(h.handle.engine.party(party.code)).toBeUndefined();
  });
});
