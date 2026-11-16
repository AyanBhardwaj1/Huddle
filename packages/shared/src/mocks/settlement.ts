import type { CreatePartyParams, DepositRequest, SettlementClient, SignedClaim } from '../interfaces';
import { settleClaims } from '../math/settle';
import { b58encode, randomId, verifyStateSig } from '../state';
import type { ChainEvent, SettlementMode } from '../types';
import nacl from 'tweetnacl';

interface MockParty {
  address: string;
  host: string;
  boxSigner: string;
  bond: number;
  challengeSecs: number;
  requireMemberSig: boolean;
  status: 'open' | 'closing' | 'finalized';
  closeRequestedAt?: number;
  deposits: Record<string, number>;
  claims: Record<string, { nonce: number; balance: number }>;
  payouts?: Record<string, number>;
  withdrawn: Set<string>;
}

/**
 * In-memory stand-in for the huddle_vault program. Runs the same rules as the on-chain program
 * (signature checks, higher nonce wins, bond shortfall, pro-rata cut), with no network calls.
 * Used for `SETTLEMENT=points` and for tests; `mode` is whatever the party asked for.
 */
export class MockSettlementClient implements SettlementClient {
  readonly label: string;
  private parties = new Map<string, MockParty>();
  private pendingDeposits = new Map<string, { partyAddress: string; member: string; amount: number }>();
  private wallets = new Map<string, number>();
  private listeners = new Set<(e: ChainEvent) => void>();
  private n = 0;

  constructor(
    readonly mode: SettlementMode = 'points',
    private readonly opts: { now?: () => number; skipChallengeWindow?: boolean } = {},
  ) {
    this.label = mode === 'points' ? 'Points only (no chain)' : 'Mock vault (offline)';
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
  private sig(): string {
    return `mock${(++this.n).toString().padStart(4, '0')}${randomId(8)}`;
  }
  private emit(e: Omit<ChainEvent, 'via'>): void {
    const ev: ChainEvent = { ...e, via: 'mock' };
    queueMicrotask(() => this.listeners.forEach((l) => l(ev)));
  }
  private party(address: string): MockParty {
    const p = this.parties.get(address);
    if (!p) throw new Error('party not found');
    return p;
  }

  async createParty(params: CreatePartyParams): Promise<{ partyAddress: string; txSig?: string }> {
    const address = b58encode(nacl.randomBytes(32));
    const host = b58encode(nacl.sign.keyPair.fromSecretKey(params.hostSecretKey).publicKey);
    this.parties.set(address, {
      address,
      host,
      boxSigner: params.boxSigner,
      bond: params.bond,
      challengeSecs: params.challengeSecs,
      requireMemberSig: params.requireMemberSig,
      status: 'open',
      deposits: {},
      claims: {},
      withdrawn: new Set(),
    });
    const txSig = this.sig();
    this.emit({ kind: 'create_party', signature: txSig, partyAddress: address });
    return { partyAddress: address, txSig };
  }

  async prepareDeposit(params: { partyAddress: string; member: string; amount: number }): Promise<DepositRequest> {
    if (this.party(params.partyAddress).status !== 'open') throw new Error('party is not open');
    const depositId = randomId(8);
    this.pendingDeposits.set(depositId, params);
    return { depositId, messageB64: null };
  }

  async submitDeposit(params: { depositId: string }): Promise<{ txSig?: string; amount: number }> {
    const d = this.pendingDeposits.get(params.depositId);
    if (!d) throw new Error('unknown deposit');
    this.pendingDeposits.delete(params.depositId);
    const p = this.party(d.partyAddress);
    p.deposits[d.member] = (p.deposits[d.member] ?? 0) + d.amount;
    const txSig = this.sig();
    this.emit({ kind: 'deposit', signature: txSig, partyAddress: d.partyAddress, member: d.member, amount: d.amount });
    return { txSig, amount: d.amount };
  }

  async depositFromKey(params: { partyAddress: string; secretKey: Uint8Array; amount: number }): Promise<{ txSig?: string }> {
    const member = b58encode(nacl.sign.keyPair.fromSecretKey(params.secretKey).publicKey);
    const d = await this.prepareDeposit({ partyAddress: params.partyAddress, member, amount: params.amount });
    return this.submitDeposit({ depositId: d.depositId });
  }

  async requestClose(partyAddress: string, signerSecretKey: Uint8Array): Promise<{ txSig?: string; challengeEndsAt: string }> {
    const p = this.party(partyAddress);
    const signer = b58encode(nacl.sign.keyPair.fromSecretKey(signerSecretKey).publicKey);
    if (signer !== p.host && signer !== p.boxSigner) throw new Error('only the host or the box can close');
    if (p.status === 'open') {
      p.status = 'closing';
      p.closeRequestedAt = this.now();
    }
    const txSig = this.sig();
    this.emit({ kind: 'request_close', signature: txSig, partyAddress });
    return { txSig, challengeEndsAt: new Date(p.closeRequestedAt! + p.challengeSecs * 1000).toISOString() };
  }

  async submitState(partyAddress: string, claim: SignedClaim): Promise<{ txSig?: string }> {
    const p = this.party(partyAddress);
    if (p.status !== 'closing') throw new Error('party is not closing');
    if (!(claim.member in p.deposits)) throw new Error('not a member');
    const fields = {
      party: partyAddress,
      member: claim.member,
      nonce: claim.nonce,
      balance: claim.balance,
      stateHash: claim.stateHash,
    };
    if (!verifyStateSig(fields, claim.boxSig, p.boxSigner)) throw new Error('invalid box signature');
    if (p.requireMemberSig && !(claim.memberSig && verifyStateSig(fields, claim.memberSig, claim.member))) {
      throw new Error('invalid member signature');
    }
    const existing = p.claims[claim.member];
    if (existing && existing.nonce >= claim.nonce) throw new Error('stale nonce');
    p.claims[claim.member] = { nonce: claim.nonce, balance: claim.balance };
    const txSig = this.sig();
    this.emit({ kind: 'submit_state', signature: txSig, partyAddress, member: claim.member, amount: claim.balance });
    return { txSig };
  }

  async finalize(partyAddress: string): Promise<{ txSig?: string; payouts: Record<string, number>; hostRefund: number }> {
    const p = this.party(partyAddress);
    if (p.status === 'open') throw new Error('party is not closing');
    if (p.status === 'closing') {
      const ends = p.closeRequestedAt! + p.challengeSecs * 1000;
      if (!this.opts.skipChallengeWindow && this.now() < ends) throw new Error('challenge window still open');
    }
    const claims: Record<string, number | undefined> = {};
    for (const [m, c] of Object.entries(p.claims)) claims[m] = c.balance;
    const res = settleClaims({ deposits: p.deposits, claims, bond: p.bond });
    p.status = 'finalized';
    p.payouts = res.payouts;
    const txSig = this.sig();
    this.emit({ kind: 'finalize', signature: txSig, partyAddress });
    return { txSig, payouts: res.payouts, hostRefund: res.hostRefund };
  }

  async withdraw(partyAddress: string, member: string): Promise<{ txSig?: string; amount: number }> {
    const p = this.party(partyAddress);
    if (p.status !== 'finalized' || !p.payouts) throw new Error('party is not finalized');
    if (p.withdrawn.has(member)) throw new Error('already withdrawn');
    const amount = p.payouts[member] ?? 0;
    p.withdrawn.add(member);
    this.wallets.set(member, (this.wallets.get(member) ?? 0) + amount);
    const txSig = this.sig();
    this.emit({ kind: 'withdraw', signature: txSig, partyAddress, member, amount });
    return { txSig, amount };
  }

  async faucet(wallet: string, amount: number): Promise<{ txSig?: string }> {
    this.wallets.set(wallet, (this.wallets.get(wallet) ?? 0) + amount);
    return { txSig: this.sig() };
  }

  async walletBalance(wallet: string): Promise<number> {
    return this.wallets.get(wallet) ?? 0;
  }

  subscribe(onEvent: (e: ChainEvent) => void): () => void {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  explorerUrl(): string | undefined {
    return undefined;
  }
}
