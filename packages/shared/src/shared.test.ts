import { describe, expect, it } from 'vitest';
import { AnnouncerQueue, type AnnouncerLine } from './announcer';
import { bridgeCommandSchema, bridgeEventSchema } from './bridge';
import { initialGameState } from './events';
import type { QuestionEngine } from './interfaces';
import { MockQuestionEngine, MockSettlementClient, MockSportsAdapter } from './mocks';
import { americanOdds, formatPayout, formatPct, formatUsd, toBase } from './odds';
import { clientMessageSchema, createPartySchema } from './protocol';
import {
  STATE_MESSAGE_LEN,
  ZERO_HASH,
  checkBalanceState,
  decodeStateMessage,
  encodeStateMessage,
  generateKeyPair,
  hashLedger,
  joinChallengeMessage,
  keyPairFromSecret,
  parseSecretKey,
  signBytes,
  signState,
  verifyBytes,
  verifyStateSig,
} from './state';
import { USDC, type BalanceState, type LedgerEntry } from './types';

describe('signed balance message', () => {
  const box = generateKeyPair();
  const member = generateKeyPair();
  const party = generateKeyPair().publicKey;

  it('encodes the canonical 127-byte layout', () => {
    const hash = hashLedger(ZERO_HASH, []);
    const msg = encodeStateMessage({ party, member: member.publicKey, nonce: 37, balance: 14_200_000, stateHash: hash });
    expect(msg.length).toBe(STATE_MESSAGE_LEN);
    expect(STATE_MESSAGE_LEN).toBe(127);
    expect(new TextDecoder().decode(msg.slice(0, 15))).toBe('HUDDLE_STATE_V1');
    // little-endian u64 nonce at offset 79, balance at 87
    expect(msg[79]).toBe(37);
    expect(msg[80]).toBe(0);
    const dv = new DataView(msg.buffer);
    expect(dv.getBigUint64(87, true)).toBe(14_200_000n);
    const back = decodeStateMessage(msg);
    expect(back).toEqual({ party, member: member.publicKey, nonce: 37n, balance: 14_200_000n, stateHash: hash });
  });

  it('signs and verifies with both keys, and rejects tampering', () => {
    const f = { party, member: member.publicKey, nonce: 1, balance: 10 * USDC, stateHash: ZERO_HASH };
    const boxSig = signState(f, box.secretKey);
    const memSig = signState(f, member.secretKey);
    expect(verifyStateSig(f, boxSig, box.publicKey)).toBe(true);
    expect(verifyStateSig(f, memSig, member.publicKey)).toBe(true);
    expect(verifyStateSig({ ...f, balance: 11 * USDC }, boxSig, box.publicKey)).toBe(false);
    expect(verifyStateSig(f, boxSig, member.publicKey)).toBe(false);
    expect(verifyStateSig(f, 'not-base64!!', box.publicKey)).toBe(false);
  });

  function makeState(prev: BalanceState | null, entries: LedgerEntry[], tamper?: Partial<BalanceState>): BalanceState {
    const prevBalance = prev?.balance ?? 0;
    const prevStateHash = prev?.stateHash ?? ZERO_HASH;
    const nonce = (prev?.nonce ?? 0) + 1;
    const balance = prevBalance + entries.reduce((a, e) => a + e.amount, 0);
    const stateHash = hashLedger(prevStateHash, entries);
    const boxSig = signState({ party, member: member.publicKey, nonce, balance, stateHash }, box.secretKey);
    return { member: member.publicKey, nonce, balance, prevBalance, stateHash, prevStateHash, entries, boxSig, ...tamper };
  }

  it('a phone accepts a correct chain of states and rejects bad ones', () => {
    const s1 = makeState(null, [{ seq: 1, type: 'deposit', amount: 10 * USDC }]);
    expect(checkBalanceState(s1, party, box.publicKey, null)).toEqual({ ok: true });
    const s2 = makeState(s1, [{ seq: 2, type: 'stake', marketId: 'm1', amount: -2 * USDC }]);
    expect(checkBalanceState(s2, party, box.publicKey, s1)).toEqual({ ok: true });

    // nonce gap
    expect(checkBalanceState(s2, party, box.publicKey, null).ok).toBe(false);
    // box lies about the balance but signs it: entries no longer add up
    const lie = makeState(s1, [{ seq: 2, type: 'stake', marketId: 'm1', amount: -2 * USDC }]);
    const forgedBalance = lie.balance - 1 * USDC;
    const forged: BalanceState = {
      ...lie,
      balance: forgedBalance,
      boxSig: signState({ party, member: member.publicKey, nonce: lie.nonce, balance: forgedBalance, stateHash: lie.stateHash }, box.secretKey),
    };
    expect(checkBalanceState(forged, party, box.publicKey, s1)).toEqual({ ok: false, reason: 'entries do not add up to the balance' });
    // wrong signer
    expect(checkBalanceState(s1, party, member.publicKey, null).ok).toBe(false);
    // entries swapped after signing
    const swapped = { ...s2, entries: [{ seq: 2, type: 'stake' as const, marketId: 'm2', amount: -2 * USDC }] };
    expect(checkBalanceState(swapped, party, box.publicKey, s1)).toEqual({ ok: false, reason: 'state hash mismatch' });
  });

  it('parses secret keys in CLI JSON and base58 formats', () => {
    const json = JSON.stringify(Array.from(box.secretKey));
    expect(keyPairFromSecret(parseSecretKey(json)).publicKey).toBe(box.publicKey);
    expect(keyPairFromSecret(box.secretKey.slice(0, 32)).publicKey).toBe(box.publicKey);
  });

  it('binds a session with a signed challenge', () => {
    const msg = joinChallengeMessage('abc123', 'abcd');
    const sig = signBytes(msg, member.secretKey);
    expect(verifyBytes(joinChallengeMessage('abc123', 'ABCD'), sig, member.publicKey)).toBe(true);
    expect(verifyBytes(joinChallengeMessage('other', 'ABCD'), sig, member.publicKey)).toBe(false);
  });
});

describe('mock settlement mirrors the vault rules', () => {
  it('runs deposit -> close -> submit (two sigs, higher nonce wins) -> finalize -> withdraw', async () => {
    let now = 1_000_000;
    const chain = new MockSettlementClient('vault', { now: () => now });
    const box = generateKeyPair();
    const host = generateKeyPair();
    const a = generateKeyPair();
    const b = generateKeyPair();
    const { partyAddress } = await chain.createParty({ partyId: 'p1', host: host.publicKey, boxSigner: box.publicKey, bond: 5 * USDC, challengeSecs: 60, requireMemberSig: true });
    for (const m of [a, b]) {
      const d = await chain.prepareDeposit({ partyAddress, member: m.publicKey, amount: 10 * USDC });
      await chain.submitDeposit({ depositId: d.depositId });
    }
    const claim = (m: typeof a, nonce: number, balance: number, withMember = true) => {
      const f = { party: partyAddress, member: m.publicKey, nonce, balance, stateHash: ZERO_HASH };
      return { ...f, boxSig: signState(f, box.secretKey), memberSig: withMember ? signState(f, m.secretKey) : undefined };
    };
    await expect(chain.submitState(partyAddress, claim(a, 2, 14 * USDC))).rejects.toThrow('not closing');
    await chain.requestClose(partyAddress);
    await expect(chain.submitState(partyAddress, claim(a, 2, 14 * USDC, false))).rejects.toThrow('member signature');
    await chain.submitState(partyAddress, claim(a, 2, 14 * USDC));
    await expect(chain.submitState(partyAddress, claim(a, 1, 20 * USDC))).rejects.toThrow('stale nonce');
    await chain.submitState(partyAddress, claim(b, 2, 6 * USDC));
    await expect(chain.finalize(partyAddress)).rejects.toThrow('challenge window');
    now += 61_000;
    const fin = await chain.finalize(partyAddress);
    expect(fin.payouts[a.publicKey]).toBe(14 * USDC);
    expect(fin.payouts[b.publicKey]).toBe(6 * USDC);
    expect(fin.hostRefund).toBe(5 * USDC);
    expect((await chain.withdraw(partyAddress, a.publicKey)).amount).toBe(14 * USDC);
    await expect(chain.withdraw(partyAddress, a.publicKey)).rejects.toThrow('already withdrawn');
    expect(await chain.walletBalance(a.publicKey)).toBe(14 * USDC);
  });
});

describe('protocol schemas', () => {
  it('accepts well-formed client messages and rejects junk', () => {
    const pk = generateKeyPair().publicKey;
    expect(clientMessageSchema.safeParse({ type: 'place_bet', id: '1', marketId: 'm', outcome: 'yes', stake: 1_000_000 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'place_bet', id: '1', marketId: 'm', outcome: 'yes', stake: 1.5 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'place_bet', id: '1', marketId: 'm', outcome: 'yes', stake: -5 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'amm_trade', id: '1', marketId: 'm', outcome: 'yes', side: 'sell', shares: 'all' }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'amm_trade', id: '1', marketId: 'm', outcome: 'yes', side: 'sell', shares: '1.1234567' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'host_action', id: '1', action: { action: 'set_mode', mode: 'amm' } }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'host_action', id: '1', action: { action: 'nuke' } }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'join', id: '1', partyCode: 'ABCD', playerPubkey: pk, name: 'Jake', signature: 'x' }).success).toBe(true);
    expect(createPartySchema.parse({ gameId: 'g' }).defaultMode).toBe('pool');
  });

  it('validates the bridge contract', () => {
    expect(bridgeEventSchema.safeParse({ type: 'button', id: 'lock', action: 'down' }).success).toBe(true);
    expect(bridgeCommandSchema.safeParse({ type: 'led', pattern: 'win', color: '#30D158' }).success).toBe(true);
    expect(bridgeCommandSchema.safeParse({ type: 'led', pattern: 'disco', color: '#30D158' }).success).toBe(false);
  });
});

describe('odds formatting', () => {
  it('formats money, percentages and payouts', () => {
    expect(toBase('0.10')).toBe(100_000);
    expect(formatUsd(14_200_000)).toBe('$14.20');
    expect(formatUsd(-500_000, { sign: true })).toBe('-$0.50');
    expect(formatUsd(2_000_000, { points: true, sign: true })).toBe('+2.00 pts');
    expect(formatPct(0.768)).toBe('77%');
    expect(formatPayout(0.77)).toBe('$1 pays $1.30');
    expect(americanOdds(0.77)).toBe('-335');
    expect(americanOdds(0.23)).toBe('+335');
  });
});

describe('announcer queue', () => {
  const line = (id: string, priority: AnnouncerLine['priority'], ageMs = 0, now = 100_000): AnnouncerLine => ({
    id,
    text: id,
    priority,
    createdAt: new Date(now - ageMs).toISOString(),
    event: 'big_trade',
    persona: 'soccer',
  });

  it('plays one line at a time, lets high priority preempt, and drops stale low-priority lines', async () => {
    const played: string[] = [];
    let finish: (() => void) | null = null;
    let stops = 0;
    const q = new AnnouncerQueue({
      now: () => 100_000,
      play: (l) => {
        played.push(l.id);
        return new Promise<void>((res) => (finish = res));
      },
      stop: () => {
        stops++;
        finish?.();
      },
    });
    q.push(line('low1', 'low'));
    q.push(line('stale', 'low', 7000));
    q.push(line('med', 'medium'));
    expect(q.speaking?.id).toBe('low1');
    q.push(line('HIGH', 'high'));
    expect(stops).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(q.speaking?.id).toBe('HIGH');
    finish!();
    await new Promise((r) => setTimeout(r, 0));
    expect(q.speaking?.id).toBe('med');
    finish!();
    await new Promise((r) => setTimeout(r, 0));
    expect(q.speaking).toBeNull();
    expect(played).toEqual(['low1', 'HIGH', 'med']);
  });
});

describe('mock sports + questions', () => {
  it('replays the toy match and fires the penalty market with a prior', async () => {
    const sports = new MockSportsAdapter();
    const qe: QuestionEngine = new MockQuestionEngine();
    const [game] = await sports.listGames('soccer');
    let state = initialGameState(game!.id, 'soccer', game!.home, game!.away);
    const seen: string[] = [];
    let penaltyResolved = '';
    const feed = await sports.open(game!.id, (e) => {
      state = sports.reduce(state, e);
      for (const c of qe.propose(e, state, [])) seen.push(c.templateId);
      if (e.type === 'penalty_result') {
        const r = qe.evaluate(
          { resolver: { type: 'penalty_result', params: {} }, outcomes: [], createdAtSeq: 1 } as never,
          e,
          state,
        );
        if (r && 'outcome' in r) penaltyResolved = r.outcome;
      }
    });
    feed.control!.setSpeed(200);
    feed.control!.start();
    await new Promise((r) => setTimeout(r, 600));
    feed.stop();
    expect(seen).toContain('soccer.penalty');
    expect(seen).toContain('soccer.total_goals');
    expect(penaltyResolved).toBe('yes');
    expect(state.status).toBe('final');
    expect(state.score).toEqual({ home: 2, away: 1 });
  });
});
