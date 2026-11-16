import {
  DEFAULT_PARTY_CONFIG,
  generateKeyPair,
  hashLedger,
  signState,
  USDC,
  ZERO_HASH,
  type BalanceState,
  type KeyPair,
  type LedgerEntry,
} from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import { createPlayerClient } from './session';
import { loadLastSigned, loadOrCreateWallet, memoryKv } from './wallet';

/** Minimal fake engine socket: records what the phone sends, lets the test push server messages. */
class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.onclose?.();
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const box = generateKeyPair();
const partyAddress = generateKeyPair().publicKey;

function boxState(member: string, nonce: number, prev: { balance: number; hash: string }, entries: LedgerEntry[]): BalanceState {
  const balance = prev.balance + entries.reduce((a, e) => a + e.amount, 0);
  const stateHash = hashLedger(prev.hash, entries);
  const boxSig = signState({ party: partyAddress, member, nonce, balance, stateHash }, box.secretKey);
  return { member, nonce, balance, prevBalance: prev.balance, stateHash, prevStateHash: prev.hash, entries, boxSig };
}

function snapshot(me: KeyPair, state: BalanceState | null) {
  return {
    type: 'party_state',
    party: {
      id: 'p',
      code: 'ABCD',
      name: 'Test',
      hostPubkey: box.publicKey,
      boxSigner: box.publicKey,
      game: { id: 'g', sport: 'soccer', title: 'A v B', home: { name: 'A', short: 'A' }, away: { name: 'B', short: 'B' }, status: 'replay', source: 'replay' },
      config: DEFAULT_PARTY_CONFIG,
      status: 'live',
      createdAt: new Date().toISOString(),
      chain: { partyAddress },
      joinUrl: '/j/ABCD',
    },
    players: [],
    markets: [],
    offers: [],
    fills: [],
    game: { gameId: 'g', sport: 'soccer', status: 'live', home: { name: 'A', short: 'A' }, away: { name: 'B', short: 'B' }, score: { home: 0, away: 0 }, clock: { period: 1, display: "1'" }, lastSeq: 0, counters: {}, periodScores: [] },
    scorecard: { entries: [], n: 0, nGemini: 0, brier: { room: null, model: null, gemini: null, roomOnGeminiSubset: null, modelOnGeminiSubset: null }, verdict: '' },
    gemini: { available: false, source: 'none', events: [] },
    you: { pubkey: me.publicKey, name: 'Jake', state, positions: [], drafts: [], momentMarketsAllowed: true },
    announcer: [],
    serverTime: new Date().toISOString(),
    role: 'player',
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('player connection', () => {
  it('joins with name + remote flag, countersigns, and keeps co-signing across a reload', async () => {
    const kv = memoryKv();
    const wallet = await loadOrCreateWallet(kv);
    const opts = { kv, wallet, name: 'Jake', code: 'abcd', remote: true, url: 'ws://engine/ws', WebSocketCtor: FakeSocket as unknown as typeof WebSocket };

    // First session: hello -> join, then a deposit state arrives and is countersigned.
    const c1 = await createPlayerClient(opts);
    c1.connect();
    const ws1 = FakeSocket.last!;
    ws1.push({ type: 'hello', challenge: 'abc', serverTime: new Date().toISOString(), version: '1' });
    await tick();
    const join = ws1.sent.find((m) => m.type === 'join')!;
    expect(join).toMatchObject({ partyCode: 'ABCD', role: 'player', name: 'Jake', remote: true, playerPubkey: wallet.publicKey });
    expect(typeof join.signature).toBe('string');
    ws1.push({ type: 'ack', id: join.id, ok: true });
    const s1 = boxState(wallet.publicKey, 1, { balance: 0, hash: ZERO_HASH }, [{ seq: 1, type: 'deposit', amount: 10 * USDC }]);
    ws1.push(snapshot(wallet, s1));
    await tick();
    expect(c1.getView().status).toBe('ready');
    expect(ws1.sent.some((m) => m.type === 'cosign' && m.nonce === 1)).toBe(true);
    expect((await loadLastSigned(kv, 'ABCD', wallet.publicKey))?.nonce).toBe(1);
    c1.close();

    // "Reload": a fresh client picks up the persisted state, so nonce 2 chains and is signed (no mismatch).
    const c2 = await createPlayerClient(opts);
    c2.connect();
    const ws2 = FakeSocket.last!;
    ws2.push({ type: 'hello', challenge: 'def', serverTime: new Date().toISOString(), version: '1' });
    await tick();
    const s2 = boxState(wallet.publicKey, 2, { balance: s1.balance, hash: s1.stateHash }, [{ seq: 2, type: 'stake', marketId: 'm1', amount: -2 * USDC }]);
    ws2.push(snapshot(wallet, s2));
    await tick();
    expect(c2.getView().cosignMismatch).toBeNull();
    expect(ws2.sent.some((m) => m.type === 'cosign' && m.nonce === 2)).toBe(true);
    expect((await loadLastSigned(kv, 'ABCD', wallet.publicKey))?.balance).toBe(8 * USDC);

    // A state that skips a nonce is refused and surfaces the mismatch prompt instead of being signed.
    const bad = boxState(wallet.publicKey, 4, { balance: s2.balance, hash: s2.stateHash }, []);
    ws2.push({ type: 'balance_state', state: bad });
    await tick();
    expect(c2.getView().cosignMismatch?.reason).toMatch(/nonce/);
    expect(ws2.sent.some((m) => m.type === 'cosign' && m.nonce === 4)).toBe(false);
    c2.close();
  });
});
