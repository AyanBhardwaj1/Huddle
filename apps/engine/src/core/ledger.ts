import {
  ZERO_HASH,
  b58decode,
  hashLedger,
  signState,
  verifyStateSig,
  type BalanceState,
  type LedgerEntry,
  type LedgerEntryType,
} from '@huddle/shared';
import { EngineError, InvariantError } from './errors';

/**
 * Off-chain ledger (PRD section 8). Pure: no I/O, no clocks (callers pass `now`).
 *
 * Money lives in exactly two kinds of place: a member's available balance, or a market's escrow.
 * Every change goes through one atomic `LedgerTx`; a tx that does not conserve money, would
 * overdraw a member or would overdraw an escrow is rejected before anything is touched.
 *
 * Invariant, asserted after every commit:
 *   sum(member balances) + sum(market escrows) == total deposits
 *
 * Each commit produces one new signed `BalanceState` per affected member (nonce + 1).
 */

export interface StateRecord {
  state: BalanceState;
  /** ms epoch when the engine produced the state (for the co-sign grace rule, DECISIONS D6). */
  createdAt: number;
}

export interface Account {
  pubkey: string;
  balance: number;
  deposited: number;
  nonce: number;
  stateHash: string;
  /** Last ledger entry seq used for this member. */
  entrySeq: number;
  /** Every state, ascending nonce (records[i].state.nonce === i + 1). */
  records: StateRecord[];
}

type DraftEntry = Omit<LedgerEntry, 'seq'>;

/** A base58 ed25519 public key (32 bytes): the only thing that can be a ledger member. */
export function isPubkey(s: string): boolean {
  try {
    return b58decode(s).length === 32;
  } catch {
    return false;
  }
}

function assertAmount(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new InvariantError(`${what} must be a safe integer, got ${n}`);
}

/** One atomic set of balance and escrow changes. */
export class LedgerTx {
  readonly entries = new Map<string, DraftEntry[]>();
  readonly escrow = new Map<string, number>();
  readonly deposits = new Map<string, number>();

  /** Signed change to a member's available balance. Zero amounts are ignored. */
  move(member: string, amount: number, type: LedgerEntryType, marketId?: string, memo?: string): this {
    assertAmount(amount, 'ledger amount');
    if (amount === 0) return this;
    const list = this.entries.get(member) ?? [];
    const entry: DraftEntry = { type, amount };
    if (marketId !== undefined) entry.marketId = marketId;
    if (memo !== undefined) entry.memo = memo;
    list.push(entry);
    this.entries.set(member, list);
    return this;
  }

  credit(member: string, amount: number, type: LedgerEntryType, marketId?: string, memo?: string): this {
    if (amount < 0) throw new InvariantError('credit must not be negative');
    return this.move(member, amount, type, marketId, memo);
  }

  debit(member: string, amount: number, type: LedgerEntryType, marketId?: string, memo?: string): this {
    if (amount < 0) throw new InvariantError('debit must not be negative');
    return this.move(member, -amount, type, marketId, memo);
  }

  /** Signed change to a market's escrow (positive = money moves into escrow). */
  hold(marketId: string, amount: number): this {
    assertAmount(amount, 'escrow amount');
    if (amount === 0) return this;
    this.escrow.set(marketId, (this.escrow.get(marketId) ?? 0) + amount);
    return this;
  }

  /** New money entering the party (a confirmed buy-in). */
  deposit(member: string, amount: number, memo?: string): this {
    assertAmount(amount, 'deposit');
    if (amount <= 0) throw new InvariantError('deposit must be positive');
    this.deposits.set(member, (this.deposits.get(member) ?? 0) + amount);
    return this.move(member, amount, 'deposit', undefined, memo);
  }

  get empty(): boolean {
    return this.entries.size === 0 && this.escrow.size === 0;
  }

  memberDelta(member: string): number {
    return (this.entries.get(member) ?? []).reduce((a, e) => a + e.amount, 0);
  }
}

export interface LedgerOptions {
  /** Party address (PDA or random 32 bytes), base58. Part of every signed message. */
  partyAddress: string;
  boxSecretKey: Uint8Array;
  /** Members whose key the engine holds (the house, D4): their states are countersigned at once. */
  selfSigners?: Map<string, Uint8Array>;
}

export class Ledger {
  readonly accounts = new Map<string, Account>();
  readonly escrow = new Map<string, number>();
  totalDeposits = 0;
  /** Number of successful invariant checks (tests assert this grows). */
  invariantChecks = 0;

  constructor(private readonly opts: LedgerOptions) {}

  get partyAddress(): string {
    return this.opts.partyAddress;
  }

  addMember(pubkey: string): Account {
    let acct = this.accounts.get(pubkey);
    if (!acct) {
      if (!isPubkey(pubkey)) throw new EngineError('bad_request', 'Invalid wallet address');
      acct = { pubkey, balance: 0, deposited: 0, nonce: 0, stateHash: ZERO_HASH, entrySeq: 0, records: [] };
      this.accounts.set(pubkey, acct);
    }
    return acct;
  }

  /** Restore an account loaded from storage. */
  restoreAccount(acct: Account): void {
    this.accounts.set(acct.pubkey, acct);
  }

  balanceOf(pubkey: string): number {
    return this.accounts.get(pubkey)?.balance ?? 0;
  }

  escrowOf(marketId: string): number {
    return this.escrow.get(marketId) ?? 0;
  }

  /**
   * Apply a transaction atomically. Throws `EngineError('insufficient_funds')` if a member would be
   * overdrawn and `InvariantError` for anything that should be impossible; in both cases nothing changes.
   */
  commit(tx: LedgerTx, now: number): StateRecord[] {
    // 1. Conservation: what members gain plus what escrows gain must equal the new deposits.
    let memberSum = 0;
    for (const list of tx.entries.values()) for (const e of list) memberSum += e.amount;
    let escrowSum = 0;
    for (const d of tx.escrow.values()) escrowSum += d;
    let depositSum = 0;
    for (const d of tx.deposits.values()) depositSum += d;
    if (memberSum + escrowSum !== depositSum) {
      throw new InvariantError(
        `transaction does not conserve money (members ${memberSum} + escrow ${escrowSum} != deposits ${depositSum})`,
      );
    }
    // 2. Nobody and nothing goes negative.
    for (const [member, list] of tx.entries) {
      const acct = this.accounts.get(member);
      if (!acct) throw new InvariantError(`unknown member ${member}`);
      const delta = list.reduce((a, e) => a + e.amount, 0);
      if (acct.balance + delta < 0) throw new EngineError('insufficient_funds', 'Not enough balance');
      assertAmount(acct.balance + delta, 'balance');
    }
    for (const [marketId, delta] of tx.escrow) {
      if (this.escrowOf(marketId) + delta < 0) {
        throw new InvariantError(`escrow for ${marketId} would go negative`);
      }
    }
    // 3. Build and sign every new state before touching anything, so a failure leaves no trace.
    const planned: { acct: Account; record: StateRecord; entrySeq: number }[] = [];
    for (const [member, list] of tx.entries) {
      const acct = this.accounts.get(member)!;
      let entrySeq = acct.entrySeq;
      const entries: LedgerEntry[] = list.map((e) => ({ seq: ++entrySeq, ...e }));
      const prevBalance = acct.balance;
      const prevStateHash = acct.stateHash;
      const balance = prevBalance + entries.reduce((a, e) => a + e.amount, 0);
      const nonce = acct.nonce + 1;
      const stateHash = hashLedger(prevStateHash, entries);
      const fields = { party: this.opts.partyAddress, member, nonce, balance, stateHash };
      const state: BalanceState = {
        member,
        nonce,
        balance,
        prevBalance,
        stateHash,
        prevStateHash,
        entries,
        boxSig: signState(fields, this.opts.boxSecretKey),
      };
      const selfKey = this.opts.selfSigners?.get(member);
      if (selfKey) state.memberSig = signState(fields, selfKey);
      planned.push({ acct, record: { state, createdAt: now }, entrySeq });
    }
    // 4. Apply.
    const out: StateRecord[] = [];
    for (const { acct, record, entrySeq } of planned) {
      acct.balance = record.state.balance;
      acct.nonce = record.state.nonce;
      acct.stateHash = record.state.stateHash;
      acct.entrySeq = entrySeq;
      acct.deposited += tx.deposits.get(acct.pubkey) ?? 0;
      acct.records.push(record);
      out.push(record);
    }
    for (const [marketId, delta] of tx.escrow) this.escrow.set(marketId, this.escrowOf(marketId) + delta);
    this.totalDeposits += depositSum;
    this.assertInvariant();
    return out;
  }

  /** Store a member's countersignature. Idempotent. Returns the record when it was newly signed. */
  cosign(member: string, nonce: number, signatureB64: string): StateRecord | null {
    const acct = this.accounts.get(member);
    const record = acct?.records[nonce - 1];
    if (!acct || !record || record.state.nonce !== nonce) throw new EngineError('not_found', 'No such balance state');
    if (record.state.memberSig) return null;
    const s = record.state;
    const fields = { party: this.opts.partyAddress, member, nonce, balance: s.balance, stateHash: s.stateHash };
    if (!verifyStateSig(fields, signatureB64, member)) {
      throw new EngineError('unauthorized', 'Signature does not match this balance state');
    }
    s.memberSig = signatureB64;
    return record;
  }

  latest(member: string): StateRecord | undefined {
    return this.accounts.get(member)?.records.at(-1);
  }

  /** Highest-nonce state that carries the member's signature. */
  latestSigned(member: string): StateRecord | undefined {
    const records = this.accounts.get(member)?.records ?? [];
    for (let i = records.length - 1; i >= 0; i--) if (records[i]!.state.memberSig) return records[i];
    return undefined;
  }

  /** States after the last countersigned one, oldest first. */
  unsigned(member: string): StateRecord[] {
    const records = this.accounts.get(member)?.records ?? [];
    let i = records.length;
    while (i > 0 && !records[i - 1]!.state.memberSig) i--;
    return records.slice(i);
  }

  sumBalances(): number {
    let s = 0;
    for (const a of this.accounts.values()) s += a.balance;
    return s;
  }

  sumEscrow(): number {
    let s = 0;
    for (const v of this.escrow.values()) s += v;
    return s;
  }

  /** sum(balances) + sum(escrows) == total deposits, and nothing is negative. */
  checkInvariant(): { ok: boolean; balances: number; escrow: number; deposits: number } {
    const balances = this.sumBalances();
    const escrow = this.sumEscrow();
    let ok = balances + escrow === this.totalDeposits;
    let deposited = 0;
    for (const a of this.accounts.values()) {
      if (a.balance < 0) ok = false;
      deposited += a.deposited;
    }
    for (const v of this.escrow.values()) if (v < 0) ok = false;
    if (deposited !== this.totalDeposits) ok = false;
    return { ok, balances, escrow, deposits: this.totalDeposits };
  }

  assertInvariant(): void {
    const c = this.checkInvariant();
    if (!c.ok) {
      throw new InvariantError(
        `ledger invariant broken: balances ${c.balances} + escrow ${c.escrow} != deposits ${c.deposits}`,
      );
    }
    this.invariantChecks++;
  }
}
