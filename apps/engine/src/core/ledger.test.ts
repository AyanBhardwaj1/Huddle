import { USDC, ZERO_HASH, checkBalanceState, generateKeyPair, signState, verifyStateSig, type BalanceState } from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import { EngineError, InvariantError } from './errors';
import { Ledger, LedgerTx } from './ledger';

function setup() {
  const box = generateKeyPair();
  const house = generateKeyPair();
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const partyAddress = generateKeyPair().publicKey;
  const ledger = new Ledger({ partyAddress, boxSecretKey: box.secretKey, selfSigners: new Map([[house.publicKey, house.secretKey]]) });
  for (const k of [house, alice, bob]) ledger.addMember(k.publicKey);
  return { ledger, box, house, alice, bob, partyAddress };
}

describe('ledger', () => {
  it('credits a deposit as state #1 with a valid box signature', () => {
    const { ledger, box, alice, partyAddress } = setup();
    const [rec] = ledger.commit(new LedgerTx().deposit(alice.publicKey, 10 * USDC), 1000);
    const s = rec!.state;
    expect(s.nonce).toBe(1);
    expect(s.balance).toBe(10 * USDC);
    expect(s.prevBalance).toBe(0);
    expect(s.prevStateHash).toBe(ZERO_HASH);
    expect(s.entries).toEqual([{ seq: 1, type: 'deposit', amount: 10 * USDC }]);
    expect(
      verifyStateSig({ party: partyAddress, member: alice.publicKey, nonce: 1, balance: s.balance, stateHash: s.stateHash }, s.boxSig, box.publicKey),
    ).toBe(true);
    expect(ledger.totalDeposits).toBe(10 * USDC);
    expect(ledger.checkInvariant().ok).toBe(true);
  });

  it('produces a chain of states that the phone-side check accepts', () => {
    const { ledger, box, alice, partyAddress } = setup();
    ledger.commit(new LedgerTx().deposit(alice.publicKey, 10 * USDC), 1);
    ledger.commit(new LedgerTx().debit(alice.publicKey, 3 * USDC, 'stake', 'm1').hold('m1', 3 * USDC), 2);
    ledger.commit(new LedgerTx().credit(alice.publicKey, 3 * USDC, 'refund', 'm1').hold('m1', -3 * USDC), 3);
    let prev: BalanceState | null = null;
    for (const r of ledger.accounts.get(alice.publicKey)!.records) {
      expect(checkBalanceState(r.state, partyAddress, box.publicKey, prev)).toEqual({ ok: true });
      prev = r.state;
    }
    expect(prev!.nonce).toBe(3);
    expect(prev!.balance).toBe(10 * USDC);
  });

  it('batches all entries of one action into a single state per member', () => {
    const { ledger, alice, bob } = setup();
    ledger.commit(new LedgerTx().deposit(alice.publicKey, 10 * USDC).deposit(bob.publicKey, 10 * USDC), 1);
    const tx = new LedgerTx()
      .debit(alice.publicKey, 1 * USDC, 'stake', 'm1', 'take a')
      .debit(alice.publicKey, 2 * USDC, 'offer_lock', 'm1')
      .hold('m1', 3 * USDC);
    const out = ledger.commit(tx, 2);
    expect(out).toHaveLength(1);
    expect(out[0]!.state.entries.map((e) => e.amount)).toEqual([-1 * USDC, -2 * USDC]);
    expect(out[0]!.state.nonce).toBe(2);
    expect(ledger.accounts.get(bob.publicKey)!.nonce).toBe(1);
    expect(ledger.escrowOf('m1')).toBe(3 * USDC);
  });

  it('rejects a transaction that does not conserve money and changes nothing', () => {
    const { ledger, alice } = setup();
    ledger.commit(new LedgerTx().deposit(alice.publicKey, 10 * USDC), 1);
    expect(() => ledger.commit(new LedgerTx().credit(alice.publicKey, 1, 'payout', 'm1'), 2)).toThrow(InvariantError);
    expect(() => ledger.commit(new LedgerTx().debit(alice.publicKey, 5, 'stake', 'm1').hold('m1', 4), 2)).toThrow(InvariantError);
    expect(ledger.balanceOf(alice.publicKey)).toBe(10 * USDC);
    expect(ledger.accounts.get(alice.publicKey)!.nonce).toBe(1);
    expect(ledger.checkInvariant().ok).toBe(true);
  });

  it('never overdraws a member or an escrow', () => {
    const { ledger, alice, bob } = setup();
    ledger.commit(new LedgerTx().deposit(alice.publicKey, 10 * USDC), 1);
    const overdraw = new LedgerTx().debit(alice.publicKey, 10 * USDC + 1, 'stake', 'm1').hold('m1', 10 * USDC + 1);
    expect(() => ledger.commit(overdraw, 2)).toThrowError(EngineError);
    try {
      ledger.commit(overdraw, 2);
    } catch (e) {
      expect((e as EngineError).code).toBe('insufficient_funds');
    }
    expect(() => ledger.commit(new LedgerTx().credit(bob.publicKey, 1, 'payout', 'm1').hold('m1', -1), 2)).toThrow(InvariantError);
    expect(ledger.balanceOf(alice.publicKey)).toBe(10 * USDC);
    expect(ledger.balanceOf(bob.publicKey)).toBe(0);
    expect(ledger.escrowOf('m1')).toBe(0);
  });

  it('rejects non-integer amounts', () => {
    const { ledger, alice } = setup();
    expect(() => new LedgerTx().move(alice.publicKey, 0.5, 'adjust')).toThrow(InvariantError);
    expect(() => new LedgerTx().hold('m1', 1.5)).toThrow(InvariantError);
    expect(() => ledger.commit(new LedgerTx().deposit(alice.publicKey, 1), 1)).not.toThrow();
  });

  it('tracks countersignatures and rejects a wrong one', () => {
    const { ledger, alice, bob, partyAddress } = setup();
    ledger.commit(new LedgerTx().deposit(alice.publicKey, 10 * USDC), 1);
    ledger.commit(new LedgerTx().debit(alice.publicKey, 1 * USDC, 'stake', 'm1').hold('m1', 1 * USDC), 2);
    expect(ledger.unsigned(alice.publicKey).map((r) => r.state.nonce)).toEqual([1, 2]);
    expect(ledger.latestSigned(alice.publicKey)).toBeUndefined();
    const sigFor = (nonce: number, key: Uint8Array): string => {
      const s = ledger.accounts.get(alice.publicKey)!.records[nonce - 1]!.state;
      return signState({ party: partyAddress, member: alice.publicKey, nonce, balance: s.balance, stateHash: s.stateHash }, key);
    };
    expect(() => ledger.cosign(alice.publicKey, 1, sigFor(1, bob.secretKey))).toThrowError(/Signature/);
    expect(() => ledger.cosign(alice.publicKey, 9, sigFor(1, alice.secretKey))).toThrowError(/No such/);
    expect(ledger.cosign(alice.publicKey, 1, sigFor(1, alice.secretKey))).not.toBeNull();
    expect(ledger.cosign(alice.publicKey, 1, sigFor(1, alice.secretKey))).toBeNull(); // idempotent
    expect(ledger.unsigned(alice.publicKey).map((r) => r.state.nonce)).toEqual([2]);
    expect(ledger.latestSigned(alice.publicKey)!.state.nonce).toBe(1);
    ledger.cosign(alice.publicKey, 2, sigFor(2, alice.secretKey));
    expect(ledger.unsigned(alice.publicKey)).toEqual([]);
    expect(ledger.latestSigned(alice.publicKey)!.state.nonce).toBe(2);
  });

  it('countersigns the house states itself', () => {
    const { ledger, house, partyAddress } = setup();
    const [rec] = ledger.commit(new LedgerTx().deposit(house.publicKey, 20 * USDC), 1);
    const s = rec!.state;
    expect(s.memberSig).toBeDefined();
    expect(
      verifyStateSig({ party: partyAddress, member: house.publicKey, nonce: 1, balance: s.balance, stateHash: s.stateHash }, s.memberSig!, house.publicKey),
    ).toBe(true);
  });
});
