import { PublicKey } from '@solana/web3.js';

/** Anchor account discriminators: sha256("account:<Name>")[0..8]. */
export const PARTY_DISCRIMINATOR = Uint8Array.from([208, 64, 165, 146, 114, 138, 161, 100]);
export const MEMBER_DISCRIMINATOR = Uint8Array.from([54, 19, 162, 21, 29, 166, 17, 198]);

/** 8 (discriminator) + Member::INIT_SPACE. Used as a getProgramAccounts dataSize filter. */
export const MEMBER_ACCOUNT_SIZE = 8 + 32 + 32 + 8 + 8 + 8 + 32 + 1 + 1 + 8 + 1;
/** Offset of `party` inside a Member account (right after the discriminator). */
export const MEMBER_PARTY_OFFSET = 8;

export type PartyStatus = 'open' | 'closing' | 'finalized';
const STATUSES: PartyStatus[] = ['open', 'closing', 'finalized'];

export interface PartyAccount {
  host: PublicKey;
  partyId: Uint8Array;
  boxSigner: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  status: PartyStatus;
  requireMemberSig: boolean;
  bump: number;
  vaultBump: number;
  memberCount: number;
  claimsCount: number;
  withdrawnCount: number;
  challengeSecs: number;
  createdAt: number;
  closeRequestedAt: number;
  finalizedAt: number;
  totalDeposits: bigint;
  bond: bigint;
  claimedDeposits: bigint;
  sumClaims: bigint;
  finalizedSum: bigint;
  available: bigint;
  cut: boolean;
  hostRefund: bigint;
  hostRefundPaid: boolean;
  totalPaid: bigint;
}

export interface MemberAccount {
  party: PublicKey;
  wallet: PublicKey;
  deposited: bigint;
  claimBalance: bigint;
  claimNonce: bigint;
  claimStateHash: Uint8Array;
  hasClaim: boolean;
  withdrawn: boolean;
  paidOut: bigint;
  bump: number;
}

class Reader {
  private o = 0;
  private readonly dv: DataView;
  constructor(private readonly b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  bytes(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new Error('account data too short');
    const s = this.b.slice(this.o, this.o + n);
    this.o += n;
    return s;
  }
  pubkey(): PublicKey {
    return new PublicKey(this.bytes(32));
  }
  u8(): number {
    return this.bytes(1)[0] as number;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u32(): number {
    const v = this.dv.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  i64(): number {
    const v = this.dv.getBigInt64(this.o, true);
    this.o += 8;
    return Number(v);
  }
  u64(): bigint {
    const v = this.dv.getBigUint64(this.o, true);
    this.o += 8;
    return v;
  }
  u128(): bigint {
    const lo = this.u64();
    const hi = this.u64();
    return (hi << 64n) | lo;
  }
}

function expectDiscriminator(data: Uint8Array, disc: Uint8Array, name: string): void {
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) throw new Error(`not a ${name} account`);
}

/** Borsh layout of the on-chain `Party` account (programs/huddle_vault/src/state.rs). */
export function decodeParty(data: Uint8Array): PartyAccount {
  expectDiscriminator(data, PARTY_DISCRIMINATOR, 'Party');
  const r = new Reader(data.subarray(8));
  const host = r.pubkey();
  const partyId = r.bytes(32);
  const boxSigner = r.pubkey();
  const mint = r.pubkey();
  const vault = r.pubkey();
  const statusByte = r.u8();
  const status = STATUSES[statusByte];
  if (!status) throw new Error(`unknown party status ${statusByte}`);
  return {
    host,
    partyId,
    boxSigner,
    mint,
    vault,
    status,
    requireMemberSig: r.bool(),
    bump: r.u8(),
    vaultBump: r.u8(),
    memberCount: r.u32(),
    claimsCount: r.u32(),
    withdrawnCount: r.u32(),
    challengeSecs: r.u32(),
    createdAt: r.i64(),
    closeRequestedAt: r.i64(),
    finalizedAt: r.i64(),
    totalDeposits: r.u64(),
    bond: r.u64(),
    claimedDeposits: r.u64(),
    sumClaims: r.u128(),
    finalizedSum: r.u128(),
    available: r.u64(),
    cut: r.bool(),
    hostRefund: r.u64(),
    hostRefundPaid: r.bool(),
    totalPaid: r.u64(),
  };
}

/** Borsh layout of the on-chain `Member` account. */
export function decodeMember(data: Uint8Array): MemberAccount {
  expectDiscriminator(data, MEMBER_DISCRIMINATOR, 'Member');
  const r = new Reader(data.subarray(8));
  return {
    party: r.pubkey(),
    wallet: r.pubkey(),
    deposited: r.u64(),
    claimBalance: r.u64(),
    claimNonce: r.u64(),
    claimStateHash: r.bytes(32),
    hasClaim: r.bool(),
    withdrawn: r.bool(),
    paidOut: r.u64(),
    bump: r.u8(),
  };
}

// ───────────────────────── finalize math (mirror of settle.rs and of settleClaims in @huddle/shared) ─────────────────────────

export interface OnChainSettlement {
  finalizedSum: bigint;
  available: bigint;
  cut: boolean;
  /** Paid by the first `withdraw_host` (remaining bond + surplus). Rounding dust is extra. */
  hostRefund: bigint;
}

/** What `finalize` will store, from the Party's running sums. */
export function settleFromParty(p: Pick<PartyAccount, 'totalDeposits' | 'bond' | 'sumClaims' | 'claimedDeposits'>): OnChainSettlement {
  const finalizedSum = p.sumClaims + (p.totalDeposits - p.claimedDeposits);
  const available = p.totalDeposits + p.bond;
  const cut = finalizedSum > available;
  return { finalizedSum, available, cut, hostRefund: cut ? 0n : available - finalizedSum };
}

/** A member's final amount, exactly as `withdraw` computes it. */
export function memberPayout(m: Pick<MemberAccount, 'hasClaim' | 'claimBalance' | 'deposited'>, s: OnChainSettlement): bigint {
  const effective = m.hasClaim ? m.claimBalance : m.deposited;
  return s.cut ? (effective * s.available) / s.finalizedSum : effective;
}
