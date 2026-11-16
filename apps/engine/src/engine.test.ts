import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HuddleClient,
  RequestError,
  USDC,
  generateKeyPair,
  joinChallengeMessage,
  signBytes,
  signState,
  wsUrlFor,
  type ChainEvent,
  type HostAction,
  type ServerMessage,
} from '@huddle/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SigningSettlement, TEST_ENV, sleep, startTestEngine, waitUntil, type Harness, type TestPlayer } from './test-harness';

/** Protocol, money-path and REST tests against an in-process engine with mocked adapters. */

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof RequestError) return e.code;
    throw e;
  }
}

let h: Harness;

beforeAll(async () => {
  // A long dispute window (200 s nominal = 10 s at 20x) so tests can act inside it.
  h = await startTestEngine({ partyDefaults: { disputeSecs: 200 } });
});

afterAll(async () => {
  await h.close();
});

async function setup(body: Parameters<Harness['createParty']>[0] = {}, names: string[] = ['Ayan', 'Jake']) {
  const created = await h.createParty({ buyIn: 10, houseBudget: 20, ...body });
  const box = await h.box(created.party.code, created.hostToken);
  const players: TestPlayer[] = [];
  for (const name of names) players.push(await h.player(created.party.code, name, { buyIn: 10 * USDC }));
  const host = (action: HostAction): Promise<Record<string, unknown>> => h.host(box, action);
  const market = async (mode: 'pool' | 'amm' | 'bet', extra: { lockInSecs?: number; question?: string } = {}): Promise<string> => {
    const res = await host({ action: 'create_market', question: extra.question ?? 'Will he score?', outcomes: ['Yes', 'No'], mode, ...(extra.lockInSecs ? { lockInSecs: extra.lockInSecs } : {}) });
    return res.marketId as string;
  };
  const settled = (): Promise<void> =>
    waitUntil(() => players.every((p) => created.rt.core.ledger.unsigned(p.pubkey).length === 0), 5000, 'countersignatures');
  return { ...created, box, players, host, market, settled };
}

describe('betting over WebSocket', () => {
  it('enforces stake limits and insufficient funds, and acks carry the result', async () => {
    const s = await setup();
    const [a] = s.players as [TestPlayer];
    const id = await s.market('pool');
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: 50_000 }))).toBe('min_stake');
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: 11 * USDC }))).toBe('insufficient_funds');
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: 6 * USDC }))).toBe('stake_limit');
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: 'nope', outcome: 'yes', stake: USDC }))).toBe('not_found');
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: id, outcome: 'maybe', stake: USDC }))).toBe('bad_request');
    expect(a.balance()).toBe(10 * USDC);
    await a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: 5 * USDC });
    // By the time the ack arrives the client's view is already up to date.
    expect(a.balance()).toBe(5 * USDC);
    const snap = a.client.getView().snapshot!;
    expect(snap.you!.positions).toMatchObject([{ marketId: id, outcome: 'yes', stake: 5 * USDC }]);
    expect(snap.markets.find((m) => m.id === id)).toMatchObject({ volume: 5 * USDC, pool: { yes: 5 * USDC, no: 0 } });
    expect(snap.fills.at(-1)).toMatchObject({ kind: 'pool_bet', amount: 5 * USDC, playerName: 'Ayan' });
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: id, outcome: 'no', stake: 100_000 }))).toBe('stake_limit');
    // The host caps total buy-ins (5x the buy-in by default).
    expect(await codeOf(a.client.request({ type: 'buy_in', amount: 45 * USDC }))).toBe('stake_limit');
    await s.settled();
    expect(s.rt.core.ledger.checkInvariant().ok).toBe(true);
    expect(s.rt.internalErrors).toBe(0);
  });

  it('rejects malformed messages with bad_request and keeps the connection usable', async () => {
    const s = await setup({}, ['Ayan']);
    const [a] = s.players as [TestPlayer];
    const bad = { type: 'place_bet', marketId: 'x', outcome: 'yes', stake: 1.5 } as unknown as Parameters<HuddleClient['request']>[0];
    expect(await codeOf(a.client.request(bad))).toBe('bad_request');
    expect(await codeOf(a.client.request({ type: 'ping' }))).toBe('ok');
  });

  it('dispute flow: the host changes the outcome and the payout is reversed', async () => {
    const s = await setup();
    const [a, b] = s.players as [TestPlayer, TestPlayer];
    const id = await s.market('pool');
    await a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: 3 * USDC });
    await b.client.request({ type: 'place_bet', marketId: id, outcome: 'no', stake: 2 * USDC });
    await s.host({ action: 'resolve', marketId: id, outcome: 'yes' });
    await waitUntil(() => a.balance() === 12 * USDC && b.balance() === 8 * USDC, 3000, 'first payout');
    const view = (): string | undefined => b.client.getView().snapshot!.markets.find((m) => m.id === id)?.state;
    expect(view()).toBe('resolved');

    await b.client.request({ type: 'dispute', marketId: id, reason: 'he clearly missed' });
    expect(view()).toBe('disputed');
    await waitUntil(() => s.box.getView().snapshot!.markets.find((m) => m.id === id)?.state === 'disputed', 3000, 'the dispute on the box');
    expect(s.box.getView().snapshot!.markets.find((m) => m.id === id)!.dispute).toMatchObject({ by: b.pubkey, reason: 'he clearly missed' });

    await s.host({ action: 'resolve', marketId: id, outcome: 'no' });
    await waitUntil(() => a.balance() === 7 * USDC && b.balance() === 13 * USDC, 3000, 'reversed payout');
    expect(b.client.getView().snapshot!.markets.find((m) => m.id === id)).toMatchObject({ state: 'final', outcome: 'no' });
    await waitUntil(() => a.client.getView().snapshot!.scorecard.entries[0]?.outcome === 'no', 3000, 'the corrected scorecard');
    expect(a.client.getView().snapshot!.scorecard.entries).toMatchObject([{ marketId: id, outcome: 'no' }]);
    await s.settled();
    expect(a.client.getView().cosignMismatch).toBeNull();
    expect(s.rt.core.ledger.checkInvariant().ok).toBe(true);
    // A final market cannot be disputed or resolved again.
    expect(await codeOf(b.client.request({ type: 'dispute', marketId: id, reason: 'again' }))).toBe('market_closed');
    expect(await codeOf(s.host({ action: 'resolve', marketId: id, outcome: 'yes' }))).toBe('market_closed');
  });

  it('void refunds every stake and trade at cost', async () => {
    const s = await setup();
    const [a, b] = s.players as [TestPlayer, TestPlayer];
    const amm = await s.market('amm');
    await a.client.request({ type: 'place_bet', marketId: amm, outcome: 'yes', stake: 2 * USDC });
    await b.client.request({ type: 'amm_trade', marketId: amm, outcome: 'no', side: 'buy', spend: 1 * USDC });
    await a.client.request({ type: 'amm_trade', marketId: amm, outcome: 'yes', side: 'sell', shares: 'all' });
    const bet = await s.market('bet', { question: 'Head to head?' });
    const posted = await a.client.request({ type: 'post_offer', marketId: bet, side: 'yes', makerStake: 2 * USDC, odds: 1.5 });
    await b.client.request({ type: 'take_offer', offerId: posted.offerId as string, amount: 500_000 });
    expect(a.balance()).toBeLessThan(10 * USDC);
    expect(s.rt.core.ledger.balanceOf(s.party.hostPubkey)).toBe(18 * USDC);

    await s.host({ action: 'void', marketId: amm, reason: 'wrong call' });
    await s.host({ action: 'void', marketId: bet });
    await waitUntil(() => a.balance() === 10 * USDC && b.balance() === 10 * USDC, 3000, 'refunds');
    expect(s.rt.core.ledger.balanceOf(s.party.hostPubkey)).toBe(20 * USDC);
    await waitUntil(() => a.client.getView().snapshot!.you!.positions.length === 0 && a.client.getView().snapshot!.scorecard.n === 0, 3000, 'cleared positions');
    const snap = a.client.getView().snapshot!;
    expect(snap.markets.find((m) => m.id === amm)).toMatchObject({ state: 'voided', voidReason: 'wrong call' });
    expect(snap.markets.find((m) => m.id === bet)!.state).toBe('voided');
    expect(snap.you!.positions).toEqual([]);
    expect(snap.offers.every((o) => !o.open)).toBe(true);
    expect(snap.scorecard.n).toBe(0);
    expect(s.rt.core.ledger.sumEscrow()).toBe(0);
    expect(s.rt.core.ledger.checkInvariant().ok).toBe(true);
  });

  it('a voice request only creates a draft; the bet happens on confirm', async () => {
    const s = await setup();
    const [a, b] = s.players as [TestPlayer, TestPlayer];
    const id = await s.market('pool');
    const nonce = s.rt.core.ledger.accounts.get(a.pubkey)!.nonce;
    await a.client.request({ type: 'talk_text', text: 'put 2 on yes for me' });
    await waitUntil(() => a.client.getView().snapshot!.you!.drafts.length === 1, 3000, 'the draft');
    const draft = a.client.getView().snapshot!.you!.drafts[0]!;
    expect(draft).toMatchObject({ player: a.pubkey, marketId: id, outcome: 'yes', amount: 2 * USDC, source: 'voice' });
    // Nothing moved, and nobody else saw the draft.
    expect(a.balance()).toBe(10 * USDC);
    expect(s.rt.core.ledger.accounts.get(a.pubkey)!.nonce).toBe(nonce);
    expect(b.messages.some((m) => m.type === 'draft_bet')).toBe(false);
    // The reply was spoken to the whole room.
    await waitUntil(() => b.messages.some((m) => m.type === 'announcer' && m.line.event === 'talk_reply'), 3000, 'the spoken reply');
    expect(await codeOf(b.client.request({ type: 'confirm_draft', draftId: draft.id }))).toBe('not_found');

    await a.client.request({ type: 'confirm_draft', draftId: draft.id });
    expect(a.balance()).toBe(8 * USDC);
    expect(a.client.getView().snapshot!.you!.drafts).toEqual([]);
    expect(a.client.getView().snapshot!.you!.positions).toMatchObject([{ marketId: id, outcome: 'yes', stake: 2 * USDC }]);

    await a.client.request({ type: 'talk_text', text: '1 on no' });
    await waitUntil(() => a.client.getView().snapshot!.you!.drafts.length === 1, 3000, 'the second draft');
    await a.client.request({ type: 'reject_draft', draftId: a.client.getView().snapshot!.you!.drafts[0]!.id });
    expect(a.client.getView().snapshot!.you!.drafts).toEqual([]);
    expect(a.balance()).toBe(8 * USDC);
    // The box can ask a question too, but a draft needs a player to belong to.
    await s.box.request({ type: 'talk_text', text: '3 on yes' });
    await sleep(100);
    expect(s.rt.core.drafts.size).toBe(0);
  });

  it('a slow announcer never delays a bet ack', async () => {
    const s = await setup({}, ['Ayan']);
    const [a] = s.players as [TestPlayer];
    const id = await s.market('pool');
    h.announcer.delayMs = 1500;
    try {
      const t0 = Date.now();
      await a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: 5 * USDC }); // a "big trade" line
      await a.client.request({ type: 'talk_text', text: 'what are the odds?' });
      expect(Date.now() - t0).toBeLessThan(500);
    } finally {
      h.announcer.delayMs = 0;
    }
  });
});

describe('sessions and authorization', () => {
  it('host actions need the host token', async () => {
    const s = await setup({}, ['Ayan']);
    const [a] = s.players as [TestPlayer];
    const id = await s.market('pool');
    expect(await codeOf(a.client.request({ type: 'host_action', action: { action: 'lock', marketId: id } }))).toBe('unauthorized');
    expect(await codeOf(a.client.request({ type: 'host_action', action: { action: 'resolve', marketId: id, outcome: 'yes' } }))).toBe('unauthorized');
    expect(await codeOf(a.client.request({ type: 'host_action', action: { action: 'end_party' } }))).toBe('unauthorized');
    expect(s.rt.core.rec(id).market.state).toBe('open');

    // A box connection with the wrong token is refused at join.
    const fake = new HuddleClient({ url: wsUrlFor(h.url), partyCode: s.party.code, role: 'box', hostToken: 'not-the-token', reconnect: false });
    fake.connect();
    await expect(fake.ready(1500)).rejects.toThrow(/Host token/);
    fake.close();

    // Spectators see the party but have no wallet and cannot bet or run the party.
    const spectator = new HuddleClient({ url: wsUrlFor(h.url), partyCode: s.party.code, role: 'spectator', reconnect: false });
    spectator.connect();
    const snap = await spectator.ready();
    expect(snap.role).toBe('spectator');
    expect(snap.you).toBeUndefined();
    expect(await codeOf(spectator.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: USDC }))).toBe('unauthorized');
    expect(await codeOf(spectator.request({ type: 'host_action', action: { action: 'lock', marketId: id } }))).toBe('unauthorized');
    spectator.close();

    // REST host endpoints need the same token.
    expect((await h.post(`/parties/${s.party.code}/close`)).status).toBe(401);
    expect((await h.post(`/replays/${s.party.game.id}/start`, { partyCode: s.party.code, action: 'start' }, { 'x-host-token': 'nope' })).status).toBe(401);
    expect(s.rt.status).toBe('lobby');
  });

  it('rejects a join whose signature does not match the player key', async () => {
    const { party } = await h.createParty();
    const ws = new WebSocket(wsUrlFor(h.url));
    const inbox: ServerMessage[] = [];
    ws.onmessage = (ev: MessageEvent) => inbox.push(JSON.parse(String(ev.data)) as ServerMessage);
    await waitUntil(() => inbox.some((m) => m.type === 'hello'), 3000, 'hello');
    const hello = inbox.find((m) => m.type === 'hello') as Extract<ServerMessage, { type: 'hello' }>;
    const victim = generateKeyPair();
    const attacker = generateKeyPair();
    const ackFor = async (id: string): Promise<Extract<ServerMessage, { type: 'ack' }>> => {
      await waitUntil(() => inbox.some((m) => m.type === 'ack' && m.id === id), 3000, `ack ${id}`);
      return inbox.find((m) => m.type === 'ack' && m.id === id) as Extract<ServerMessage, { type: 'ack' }>;
    };

    // Nothing but join works before joining.
    ws.send(JSON.stringify({ type: 'place_bet', id: 'early', marketId: 'm', outcome: 'yes', stake: 1 }));
    expect((await ackFor('early')).error?.code).toBe('not_joined');

    // Signed by someone else's key.
    const forged = signBytes(joinChallengeMessage(hello.challenge, party.code), attacker.secretKey);
    ws.send(JSON.stringify({ type: 'join', id: 'j1', partyCode: party.code, role: 'player', playerPubkey: victim.publicKey, name: 'Mallory', signature: forged }));
    expect(await ackFor('j1')).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    // A valid signature over a different challenge (a replay) fails too.
    const replay = signBytes(joinChallengeMessage('some-old-challenge', party.code), victim.secretKey);
    ws.send(JSON.stringify({ type: 'join', id: 'j2', partyCode: party.code, role: 'player', playerPubkey: victim.publicKey, name: 'Mallory', signature: replay }));
    expect((await ackFor('j2')).error?.code).toBe('unauthorized');
    // No signature at all.
    ws.send(JSON.stringify({ type: 'join', id: 'j3', partyCode: party.code, role: 'player', playerPubkey: victim.publicKey, name: 'Mallory' }));
    expect((await ackFor('j3')).error?.code).toBe('unauthorized');
    ws.send(JSON.stringify({ type: 'join', id: 'j4', partyCode: 'ZZZZ', role: 'spectator' }));
    expect((await ackFor('j4')).error?.code).toBe('not_found');
    expect(inbox.some((m) => m.type === 'party_state')).toBe(false);
    expect(h.handle.engine.party(party.code)!.core.members.has(victim.publicKey)).toBe(false);

    // The right key on the same connection is accepted.
    const good = signBytes(joinChallengeMessage(hello.challenge, party.code), victim.secretKey);
    ws.send(JSON.stringify({ type: 'join', id: 'j5', partyCode: party.code, role: 'player', playerPubkey: victim.publicKey, name: 'Vic', signature: good }));
    expect((await ackFor('j5')).ok).toBe(true);
    await waitUntil(() => inbox.some((m) => m.type === 'party_state'), 3000, 'party_state');
    ws.close();
  });

  it('a player can only countersign their own balance, with a valid signature', async () => {
    const s = await setup();
    const [a, b] = s.players as [TestPlayer, TestPlayer];
    const state = a.client.getView().snapshot!.you!.state!;
    const sig = signState(
      { party: s.party.chain.partyAddress, member: a.pubkey, nonce: state.nonce, balance: state.balance, stateHash: state.stateHash },
      b.keyPair.secretKey,
    );
    expect(await codeOf(b.client.request({ type: 'cosign', member: a.pubkey, nonce: state.nonce, signature: sig }))).toBe('unauthorized');
    const id = await s.market('pool');
    await a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: USDC });
    await s.settled();
    const latest = s.rt.core.ledger.latest(a.pubkey)!.state;
    expect(latest.memberSig).toBeDefined();
    // A signature over the wrong balance is refused (replaying an old signature for a new nonce).
    const old = s.rt.core.ledger.accounts.get(a.pubkey)!.records[0]!.state.memberSig!;
    expect(await codeOf(a.client.request({ type: 'cosign', member: a.pubkey, nonce: 99, signature: old }))).toBe('not_found');
  });

  it('blocks bets while a balance is un-countersigned (D6) and re-sends pending states on reconnect', async () => {
    const created = await h.createParty({ buyIn: 10, houseBudget: 0 });
    const box = await h.box(created.party.code, created.hostToken);
    const { rt, party } = created;
    const a = await h.player(party.code, 'Slow phone', { buyIn: 10 * USDC, autoCosign: false });
    const id = (await h.host(box, { action: 'create_market', question: 'Game long?', outcomes: ['Yes', 'No'], mode: 'pool' })).marketId as string;
    await sleep(700); // past the 10 s grace (0.5 s at 20x)
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: USDC }))).toBe('cosign_required');

    const cosign = async (nonce: number): Promise<void> => {
      const st = rt.core.ledger.accounts.get(a.pubkey)!.records[nonce - 1]!.state;
      const signature = signState({ party: party.chain.partyAddress, member: a.pubkey, nonce, balance: st.balance, stateHash: st.stateHash }, a.keyPair.secretKey);
      await a.client.request({ type: 'cosign', member: a.pubkey, nonce, signature });
    };
    await cosign(1);
    await a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: USDC });
    await a.client.request({ type: 'place_bet', marketId: id, outcome: 'no', stake: USDC });
    expect(rt.core.ledger.unsigned(a.pubkey).map((r) => r.state.nonce)).toEqual([2, 3]);
    const lastSigned = rt.core.ledger.latestSigned(a.pubkey)!.state;
    a.client.close();
    await waitUntil(() => (rt.core.connected.get(a.pubkey) ?? 0) === 0, 3000, 'disconnect');
    expect(rt.core.players().find((p) => p.pubkey === a.pubkey)!.connected).toBe(false);

    // The phone comes back with auto co-sign: it gets both pending states, oldest first, and signs them.
    const back = await h.player(party.code, 'Slow phone', { keyPair: a.keyPair, lastSigned });
    await waitUntil(() => rt.core.ledger.unsigned(a.pubkey).length === 0, 3000, 'catch-up signatures');
    expect(back.client.getView().cosignMismatch).toBeNull();
    expect(back.client.getView().lastSigned!.nonce).toBe(3);
    expect(back.balance()).toBe(8 * USDC);
    expect(rt.core.players().find((p) => p.pubkey === a.pubkey)!.connected).toBe(true);
    expect(await codeOf(back.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: USDC }))).toBe('ok');
  });

  it('trusted-host parties never wait for the phone', async () => {
    const created = await h.createParty({ buyIn: 10, settlement: 'trusted' });
    expect(created.party.config.requireMemberSig).toBe(false);
    const box = await h.box(created.party.code, created.hostToken);
    const a = await h.player(created.party.code, 'No cosign', { buyIn: 10 * USDC, autoCosign: false });
    const id = (await h.host(box, { action: 'create_market', question: 'Trusted?', outcomes: ['Yes', 'No'], mode: 'pool' })).marketId as string;
    await sleep(700);
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: id, outcome: 'yes', stake: USDC }))).toBe('ok');
    await h.host(box, { action: 'resolve', marketId: id, outcome: 'yes' });
    await h.host(box, { action: 'confirm_result', marketId: id });
    await h.host(box, { action: 'end_party' });
    await waitUntil(() => created.rt.status === 'finalized', 15_000, 'trusted party to finalize');
    // Box-only signatures: the latest state is what settles, signed or not.
    const players = created.rt.core.players();
    expect(players.find((p) => p.pubkey === a.pubkey)!.payout).toBe(10 * USDC);
    expect(players.reduce((s2, p) => s2 + (p.payout ?? 0), 0)).toBe(created.rt.core.ledger.totalDeposits);
  });
});

describe('deposits and chain events', () => {
  const qn = (body: unknown, headers: Record<string, string> = { 'x-qn-token': TEST_ENV.QUICKNODE_STREAM_SECRET }) => h.post('/webhooks/quicknode', body, headers);

  it('credits a deposit exactly once, whether it is confirmed directly or by the QuickNode webhook', async () => {
    const s = await setup({}, ['Ayan']);
    const [a] = s.players as [TestPlayer];
    const { rt, party } = s;
    const deposit = a.messages.find((m): m is Extract<ServerMessage, { type: 'chain_event' }> => m.type === 'chain_event' && m.event.kind === 'deposit' && m.event.member === a.pubkey);
    expect(deposit).toBeDefined();
    const sig = deposit!.event.signature;
    const record = (signature: string, amount: number, extra: Record<string, unknown> = {}) => ({
      signature,
      slot: 123,
      blockTime: 1_795_000_000,
      instruction: 'deposit',
      accounts: [],
      partyPda: party.chain.partyAddress,
      member: a.pubkey,
      amount,
      ...extra,
    });

    // No token, wrong token: refused before anything is read.
    expect((await qn([record('sig-evil', 99 * USDC)], {})).status).toBe(401);
    expect((await qn([record('sig-evil', 99 * USDC)], { 'x-qn-token': 'wrong' })).status).toBe(401);
    expect(a.balance()).toBe(10 * USDC);

    // The same deposit again through Streams: no double credit.
    const again = await qn([record(sig, 10 * USDC)]);
    expect(again).toMatchObject({ status: 200, json: { ok: true, received: 1, handled: 1 } });
    await sleep(50);
    expect(rt.core.ledger.balanceOf(a.pubkey)).toBe(10 * USDC);
    expect(rt.core.ledger.accounts.get(a.pubkey)!.nonce).toBe(1);
    // ...but screens are told Streams saw it.
    await waitUntil(() => a.messages.some((m) => m.type === 'chain_event' && m.event.signature === sig && m.event.via === 'quicknode'), 3000, 'streams event');

    // A deposit the engine has not seen yet (wrapped in {data: [...]}), delivered twice.
    const fresh = { data: [record('5streamsFreshSig', 3 * USDC)] };
    expect((await qn(fresh)).json.handled).toBe(1);
    expect((await qn(fresh)).json.handled).toBe(1);
    await waitUntil(() => a.balance() === 13 * USDC, 3000, 'webhook credit');
    await sleep(50);
    expect(rt.core.ledger.balanceOf(a.pubkey)).toBe(13 * USDC);
    expect(rt.core.ledger.accounts.get(a.pubkey)!.deposited).toBe(13 * USDC);
    expect(rt.core.ledger.totalDeposits).toBe(33 * USDC);
    const ev = a.messages.filter((m) => m.type === 'chain_event' && m.event.signature === '5streamsFreshSig');
    expect(ev).toHaveLength(1);
    expect((ev[0] as { event: ChainEvent }).event).toMatchObject({ kind: 'deposit', via: 'quicknode', amount: 3 * USDC, slot: 123 });

    // QuickNode's HMAC headers work as well; garbage and unknown parties are ignored.
    const body = JSON.stringify([record('5hmacSig', 1 * USDC), { nonsense: true }, record('5other', USDC, { partyPda: generateKeyPair().publicKey }), record('5badMember', USDC, { member: 'not-a-wallet' })]);
    const nonce = 'n-1';
    const ts = '1795000000';
    const signature = crypto.createHmac('sha256', TEST_ENV.QUICKNODE_STREAM_SECRET).update(nonce + ts + body).digest('hex');
    const res = await fetch(`${h.url}/webhooks/quicknode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': signature },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: 4, handled: 2 });
    await waitUntil(() => a.balance() === 14 * USDC, 3000, 'hmac credit');
    const tampered = await fetch(`${h.url}/webhooks/quicknode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': signature },
      body: body.replace('5hmacSig', '5hmacSi2'),
    });
    expect(tampered.status).toBe(401);
    await s.settled();
    expect(rt.core.ledger.checkInvariant().ok).toBe(true);
    expect(rt.internalErrors).toBe(0);
  });

  it('vault-style buy-in: the phone signs the deposit, then it is credited once', async () => {
    const hv = await startTestEngine({}, (mode) => new SigningSettlement(mode));
    try {
      const created = await hv.createParty({ buyIn: 10, houseBudget: 20, settlement: 'vault' });
      expect(created.party.config).toMatchObject({ settlement: 'vault', requireMemberSig: true, challengeSecs: 60 });
      expect(created.rt.core.ledger.balanceOf(created.party.hostPubkey)).toBe(20 * USDC);
      const a = await hv.player(created.party.code, 'Ayan');
      // Step 1 asks for a signature and credits nothing.
      const step1 = await a.client.request({ type: 'buy_in', amount: 10 * USDC });
      const deposit = step1.deposit as { depositId: string; messageB64: string };
      expect(deposit.messageB64.length).toBeGreaterThan(10);
      expect(created.rt.core.ledger.balanceOf(a.pubkey)).toBe(0);
      // A signature from the wrong key is refused by the vault.
      const bad = signBytes(Buffer.from(deposit.messageB64, 'base64'), generateKeyPair().secretKey);
      expect(await codeOf(a.client.request({ type: 'buy_in_sign', depositId: deposit.depositId, signature: bad }))).toBe('internal');
      expect(created.rt.core.ledger.balanceOf(a.pubkey)).toBe(0);
      expect(await codeOf(a.client.request({ type: 'buy_in_sign', depositId: 'nope', signature: bad }))).toBe('not_found');
      // The client helper does the whole round trip.
      await a.client.buyIn(10 * USDC);
      expect(a.balance()).toBe(10 * USDC);
      expect(created.rt.core.ledger.accounts.get(a.pubkey)!.nonce).toBe(1);
      const kinds = a.messages.flatMap((m) => (m.type === 'chain_event' ? [m.event.kind] : []));
      expect(kinds).toEqual(['deposit']);
      // Not points: an external withdrawal is refused with an explanation, not silently accepted.
      expect(await codeOf(a.client.request({ type: 'withdraw' }))).toBe('bad_request');
      expect(created.rt.core.ledger.checkInvariant().ok).toBe(true);
    } finally {
      await hv.close();
    }
  });
});

describe('host controls and timers', () => {
  it('locks on the countdown with a last call, and on the box LOCK button', async () => {
    const s = await setup({}, ['Ayan']);
    const before = h.announcer.events.length;
    const leds = h.bridge.commands.length;
    const timed = await s.market('pool', { lockInSecs: 10, question: 'Countdown?' }); // 0.5 s at 20x
    const m = s.rt.core.rec(timed).market;
    expect(m.kind).toBe('moment');
    expect(m.lock.at).toBeDefined();
    await waitUntil(() => m.state === 'locked', 4000, 'countdown lock');
    const said = h.announcer.events.slice(before).map((e) => e.type);
    expect(said).toEqual(expect.arrayContaining(['market_opened', 'lock_soon', 'market_locked']));
    expect(said.indexOf('lock_soon')).toBeLessThan(said.indexOf('market_locked'));
    const patterns = h.bridge.commands.slice(leds).flatMap((c) => (c.type === 'led' ? [c.pattern] : []));
    expect(patterns).toEqual(expect.arrayContaining(['market_open', 'locking', 'locked']));
    expect(await codeOf(s.players[0]!.client.request({ type: 'place_bet', marketId: timed, outcome: 'yes', stake: USDC }))).toBe('market_closed');

    const game = await s.market('pool', { question: 'Game long?' });
    const moment = await s.market('pool', { lockInSecs: 600, question: 'Moment?' });
    h.bridge.press('lock'); // the newest open moment market, not the game-long one
    expect(s.rt.core.rec(moment).market.state).toBe('locked');
    expect(s.rt.core.rec(game).market.state).toBe('open');
    // LED commands are mirrored to the box screen.
    await waitUntil(() => s.box.getView().led !== null, 3000, 'mirrored led');
    await s.host({ action: 'lock' }); // nothing but the game market is open now
    expect(s.rt.core.rec(game).market.state).toBe('locked');
    expect(await codeOf(s.host({ action: 'lock' }))).toBe('not_found');
  });

  it('holds AI drafts for approval when auto-approve is off', async () => {
    const s = await setup({ autoApprove: false }, ['Ayan']);
    const [a] = s.players as [TestPlayer];
    await s.host({ action: 'set_speed', speed: 20 });
    await s.host({ action: 'start_game' });
    const drafts = (): string[] => s.box.getView().snapshot!.markets.filter((m) => m.state === 'draft').map((m) => m.id);
    await waitUntil(() => drafts().length === 2, 5000, 'two game-long drafts at kickoff');
    await s.host({ action: 'pause_game' });
    expect(s.rt.status).toBe('live');
    expect(a.client.getView().snapshot!.markets).toEqual([]); // players never see drafts
    const [first, second] = drafts() as [string, string];
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: first, outcome: 'yes', stake: USDC }))).toBe('market_closed');
    await s.host({ action: 'set_mode', mode: 'amm', marketId: first });
    await s.host({ action: 'approve_draft', marketId: first });
    await s.host({ action: 'discard_draft', marketId: second });
    await waitUntil(() => a.client.getView().snapshot!.markets.length === 1, 3000, 'the approved market');
    expect(a.client.getView().snapshot!.markets[0]).toMatchObject({ id: first, state: 'open', mode: 'amm', createdBy: 'ai' });
    expect(s.box.getView().snapshot!.markets.find((m) => m.id === second)!.state).toBe('discarded');
    await s.host({ action: 'set_auto_approve', value: true });
    await waitUntil(() => a.client.getView().snapshot!.party.config.autoApprove === true, 3000, 'the party update');
    // A fresh snapshot for a player still leaves the discarded draft out.
    const late = await h.player(s.party.code, 'Late');
    expect(late.client.getView().snapshot!.markets.map((m) => m.id)).toEqual([first]);
    expect(late.client.getView().snapshot!.gemini.available).toBe(true);
  });

  it('remote players far out of sync are limited to game-long markets', async () => {
    const s = await setup({}, ['Remote']);
    const [a] = s.players as [TestPlayer];
    expect(await codeOf(a.client.request({ type: 'sync_mark', clientTs: Date.now() }))).toBe('not_found'); // no kickoff yet
    await s.host({ action: 'set_speed', speed: 20 });
    await s.host({ action: 'start_game' });
    await waitUntil(() => s.rt.game.status === 'live', 5000, 'kickoff');
    await s.host({ action: 'pause_game' });
    const moment = await s.market('pool', { lockInSecs: 600, question: 'Moment?' });
    const game = await s.market('pool', { question: 'Game long?' });

    const res = await a.client.request({ type: 'sync_mark', clientTs: Date.now() + 30_000 }); // sees kickoff 30 s late
    expect(res.momentMarketsAllowed).toBe(false);
    expect(res.delayMs as number).toBeGreaterThan(29_000);
    expect(a.client.getView().snapshot!.you).toMatchObject({ momentMarketsAllowed: false });
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: moment, outcome: 'yes', stake: USDC }))).toBe('delay_restricted');
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: game, outcome: 'yes', stake: USDC }))).toBe('ok');
    // Ahead of the room is capped the same way.
    expect((await a.client.request({ type: 'sync_mark', clientTs: Date.now() - 60_000 })).momentMarketsAllowed).toBe(false);
    expect((await a.client.request({ type: 'sync_mark', clientTs: Date.now() })).momentMarketsAllowed).toBe(true);
    expect(await codeOf(a.client.request({ type: 'place_bet', marketId: moment, outcome: 'yes', stake: USDC }))).toBe('ok');
  });
});

describe('REST', () => {
  it('health, games, parties, faucet and audio', async () => {
    const health = await h.get('/health');
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ ok: true, settlement: 'points', providers: { sports: 'mock', gemini: 'mock', announcer: 'mock', llm: 'mock' } });
    expect(typeof health.json.version).toBe('string');
    expect(health.headers.get('access-control-allow-origin')).toBeDefined();

    const games = (await h.get('/games?sport=soccer')).json.games as { id: string }[];
    expect(games.map((g) => g.id)).toEqual(['mock-soccer']);
    expect((await h.get('/games?sport=nfl')).json.games).toEqual([]);

    expect((await h.post('/parties', { gameId: 'no-such-game' })).status).toBe(404);
    expect((await h.post('/parties', { gameId: 'mock-soccer', buyIn: -1 })).status).toBe(400);
    const { party, hostToken } = await h.createParty({ name: 'REST party', defaultMode: 'amm', buyIn: 5 });
    expect(party.code).toMatch(/^[A-Z]{4}$/);
    expect(party).toMatchObject({ name: 'REST party', status: 'lobby', config: { defaultMode: 'amm', buyIn: 5 * USDC, maxBuyIn: 25 * USDC, persona: 'soccer' } });
    expect(party.joinUrl).toBe(`${h.url}/j/${party.code}`);
    expect(hostToken.length).toBeGreaterThan(20);
    expect(JSON.stringify(party)).not.toContain(hostToken);

    const list = (await h.get('/parties')).json.parties as { code: string }[];
    expect(list[0]!.code).toBe(party.code); // most recent first
    const detail = await h.get(`/parties/${party.code.toLowerCase()}`);
    expect(detail.json).toMatchObject({ party: { code: party.code }, game: { status: 'pre' } });
    expect((detail.json.players as { isHouse: boolean; balance: number }[])[0]).toMatchObject({ isHouse: true, balance: 50 * USDC });
    expect((await h.get('/parties/ZZZZ')).status).toBe(404);
    const redirect = await h.get('/j');
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(`/j/${party.code}`);

    const wallet = generateKeyPair().publicKey;
    expect(await h.post('/faucet', { wallet })).toMatchObject({ status: 200, json: { ok: true, amount: 25 * USDC } });
    expect((await h.post('/faucet', { wallet })).status).toBe(429); // rate-limited per wallet
    expect((await h.post('/faucet', { wallet: 'nope' })).status).toBe(400);
    expect((await h.post('/faucet', {})).status).toBe(400);

    expect((await h.get('/audio/nope')).status).toBe(404);
    expect((await h.get('/parties/no/such/route')).status).toBe(404);
  });

  it('replay control and close over REST, then announcer audio', async () => {
    const { party, hostToken, rt } = await h.createParty({ buyIn: 10, houseBudget: 0 });
    const auth = { 'x-host-token': hostToken };
    const a = await h.player(party.code, 'Ayan', { buyIn: 10 * USDC });
    expect((await h.post(`/replays/other-game/start`, { partyCode: party.code, action: 'start' }, auth)).status).toBe(400);
    expect((await h.post(`/replays/${party.game.id}/start`, { partyCode: party.code, action: 'warp' }, auth)).status).toBe(400);
    expect((await h.post(`/replays/${party.game.id}/start`, { partyCode: party.code, action: 'speed', speed: 20 }, auth)).json).toMatchObject({ ok: true, status: { speed: 20, playing: false } });
    expect((await h.post(`/replays/${party.game.id}/start`, { partyCode: party.code, action: 'start' }, auth)).json).toMatchObject({ status: { playing: true } });
    await waitUntil(() => rt.game.status === 'live', 5000, 'kickoff');
    expect(rt.status).toBe('live');
    expect((await h.post(`/replays/${party.game.id}/start`, { partyCode: party.code, action: 'pause' }, auth)).json).toMatchObject({ status: { playing: false } });
    await waitUntil(() => a.messages.some((m) => m.type === 'replay_status'), 3000, 'replay status');
    await waitUntil(() => a.messages.some((m) => m.type === 'game_event' && m.event.type === 'kickoff'), 3000, 'the kickoff event');
    await waitUntil(() => a.client.getView().snapshot!.markets.length === 2, 3000, 'the game-long markets');
    // House budget 0: the two game-long markets opened in pool mode.
    const markets = [...rt.core.markets.values()].map((r) => r.market);
    expect(markets.map((m) => m.state)).toEqual(['open', 'open']);
    await a.client.request({ type: 'place_bet', marketId: markets[0]!.id, outcome: markets[0]!.outcomes[0]!.id, stake: 2 * USDC });

    // Closing early voids what has no result and pays everyone back.
    expect(await h.post(`/parties/${party.code}/close`, {}, auth)).toMatchObject({ status: 200, json: { ok: true } });
    await waitUntil(() => rt.status === 'finalized', 15_000, 'finalize after close');
    expect(markets.map((m) => m.state)).toEqual(['voided', 'voided']);
    expect(rt.core.players().find((p) => p.pubkey === a.pubkey)).toMatchObject({ payout: 10 * USDC, balance: 10 * USDC });
    await waitUntil(() => a.client.getView().snapshot!.party.status === 'finalized', 3000, 'the finalized party update');
    await waitUntil(() => a.messages.some((m) => m.type === 'chain_event' && m.event.kind === 'withdraw'), 3000, 'the withdraw event');
    const steps = a.messages.flatMap((m) => (m.type === 'chain_event' ? [m.event.kind] : []));
    expect(steps).toEqual(expect.arrayContaining(['deposit', 'request_close', 'submit_state', 'finalize', 'withdraw']));
    expect((await h.get('/parties')).json.parties).not.toContainEqual(expect.objectContaining({ code: party.code }));
    // Points parties have nothing to withdraw; a finished party takes no bets or buy-ins.
    expect(await codeOf(a.client.request({ type: 'withdraw' }))).toBe('ok');
    expect(await codeOf(a.client.request({ type: 'buy_in', amount: USDC }))).toBe('party_closed');
    expect((await h.post(`/replays/${party.game.id}/start`, { partyCode: party.code, action: 'start' }, auth)).status).toBe(409);

    // The recap line carried audio; it is served at /audio/:id.
    await waitUntil(() => a.messages.some((m) => m.type === 'announcer' && m.line.event === 'game_recap'), 3000, 'the recap line');
    const recap = a.messages.find((m): m is Extract<ServerMessage, { type: 'announcer' }> => m.type === 'announcer' && m.line.event === 'game_recap')!;
    expect(recap.line.audioUrl).toBe(`/audio/${recap.line.id}`);
    const audio = await fetch(h.url + recap.line.audioUrl!);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('agent tools: authenticated, read-only, and draft_bet never moves money', async () => {
    const s = await setup({}, ['Ayan']);
    const [a] = s.players as [TestPlayer];
    const id = await s.market('amm');
    const session = await h.get(`/agent/session?party=${s.party.code}&player=${a.pubkey}`);
    expect(session.json.agent).toBeNull(); // no ElevenLabs agent configured
    const token = session.json.sessionToken as string;
    const secret = { 'x-huddle-secret': TEST_ENV.AGENT_TOOLS_SECRET };
    const tool = (name: string, body: Record<string, unknown>, headers: Record<string, string> = secret) => h.post(`/agent-tools/${name}`, body, headers);

    expect((await tool('get_party_state', { session_token: token }, {})).status).toBe(401);
    expect((await tool('get_party_state', { session_token: token }, { 'x-huddle-secret': 'wrong' })).status).toBe(401);
    expect((await tool('get_party_state', { session_token: `${token}x` })).status).toBe(401);
    expect((await tool('get_party_state', {})).status).toBe(401);
    expect((await h.get(`/agent/session?party=${s.party.code}&player=${generateKeyPair().publicKey}`)).status).toBe(404);

    const state = await tool('get_party_state', { session_token: token });
    expect(state.status).toBe(200);
    expect(state.json).toMatchObject({ party: 'Test party', points_only: true, score: { home: 'Portugal', away: 'Spain' } });
    expect((state.json.open_markets as { id: string }[]).map((m) => m.id)).toEqual([id]);
    expect(state.json.leaderboard).toMatchObject([{ name: 'Ayan', balance_usdc: 10 }]);
    const market = await tool('get_market', { session_token: token, market_id: id });
    expect(market.json).toMatchObject({ id, mode: 'amm', state: 'open', volume_usdc: 0 });
    expect((market.json.outcomes as { percent: string }[])[0]!.percent).toBe('50%');
    expect((await tool('explain_odds', { session_token: token, market_id: id })).json.explanation).toMatch(/percent/);
    expect((await tool('get_market', { session_token: token, market_id: 'nope' })).json).toMatchObject({ ok: false, code: 'not_found' });
    expect((await tool('launch_missiles', { session_token: token })).status).toBe(404);

    const nonce = s.rt.core.ledger.accounts.get(a.pubkey)!.nonce;
    const drafted = await tool('draft_bet', { session_token: token, player: 'someone else', market_id: id, outcome: 'Yes', amount: 3 });
    expect(drafted.json).toMatchObject({ ok: true, needs_confirmation: true });
    await waitUntil(() => a.client.getView().snapshot!.you!.drafts.length === 1, 3000, 'the agent draft');
    // The token is bound to its player, whatever name the agent passes.
    expect(a.client.getView().snapshot!.you!.drafts[0]).toMatchObject({ player: a.pubkey, outcome: 'yes', amount: 3 * USDC });
    expect(a.balance()).toBe(10 * USDC);
    expect(s.rt.core.ledger.accounts.get(a.pubkey)!.nonce).toBe(nonce);
    expect((await tool('draft_bet', { session_token: token, market_id: id, outcome: 'banana', amount: 3 })).json).toMatchObject({ ok: false });
    expect((await tool('draft_bet', { session_token: token, market_id: id, outcome: 'yes', amount: -3 })).json).toMatchObject({ ok: false });
    expect(s.rt.core.drafts.size).toBe(1);
  });

  it('serves the built apps with SPA fallback, and a helpful page when a build is missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-static-'));
    const player = path.join(dir, 'player');
    fs.mkdirSync(path.join(player, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(player, 'index.html'), '<!doctype html><title>player app</title>');
    fs.writeFileSync(path.join(player, 'assets', 'app.js'), 'console.log("player")');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'outside the web root');
    const hs = await startTestEngine({ staticDirs: { player, box: path.join(dir, 'no-such-build') } });
    try {
      const root = await hs.get('/');
      expect(root.status).toBe(200);
      expect(root.text).toContain('player app');
      expect(root.headers.get('content-type')).toContain('text/html');
      expect((await hs.get('/j/ABCD')).text).toContain('player app'); // client-side route
      const asset = await hs.get('/assets/app.js');
      expect(asset.text).toBe('console.log("player")');
      expect(asset.headers.get('content-type')).toContain('javascript');
      expect((await hs.get('/assets/missing.js')).status).toBe(404);
      expect((await hs.get('/..%2Fsecret.txt')).text).not.toContain('outside the web root');
      expect((await hs.get('/%2e%2e/secret.txt')).text).not.toContain('outside the web root');
      const box = await hs.get('/box/');
      expect(box.status).toBe(503);
      expect(box.text).toContain('pnpm --filter @huddle/box build');
      expect((await hs.get('/box')).status).toBe(302);
      const noParty = await hs.get('/j');
      expect(noParty.status).toBe(404);
      expect(noParty.text).toContain('No party is running');
      expect((await hs.get('/health')).json.ok).toBe(true);
    } finally {
      await hs.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
