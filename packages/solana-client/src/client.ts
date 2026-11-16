import {
  b64decode,
  b64encode,
  encodeStateMessage,
  hexDecode,
  keyPairFromSecret,
  randomId,
  verifyBytes,
  type ChainEvent,
  type CreatePartyParams,
  type DepositRequest,
  type SettlementClient,
  type SignedClaim,
} from '@huddle/shared';
import {
  AccountLayout,
  MintLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  Message,
  PublicKey,
  Transaction,
  type Commitment,
  type TransactionInstruction,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {
  MEMBER_ACCOUNT_SIZE,
  MEMBER_PARTY_OFFSET,
  decodeMember,
  decodeParty,
  memberPayout,
  settleFromParty,
  type MemberAccount,
  type OnChainSettlement,
  type PartyAccount,
} from './accounts';
import { parseHuddleLogs, toChainEvent } from './decode';
import { VaultTxError, toVaultError } from './errors';
import {
  ataOf,
  createPartyIx,
  depositIx,
  ed25519VerifyIx,
  finalizeIx,
  requestCloseIx,
  submitStateIx,
  withdrawHostIx,
  withdrawIx,
} from './instructions';
import { findMemberPda, findPartyPda, partyIdBytes } from './pda';

export interface VaultClientConfig {
  mode: 'vault' | 'trusted';
  rpcUrl: string;
  /** WebSocket endpoint for confirmations and `subscribe`. Derived from `rpcUrl` when omitted. */
  wsUrl?: string;
  programId: string;
  usdcMint: string;
  /** Fee payer, rent payer and faucet. Devnet only. */
  treasurySecretKey: Uint8Array;
  /** "devnet" (default) or "localnet". Only used for labels and explorer links. */
  cluster?: string;
  commitment?: Commitment;
  /**
   * `finalize` waits at most this long for the challenge window to end before giving up with
   * "challenge window still open" (the engine's clock and the cluster clock are never exactly equal).
   */
  finalizeMaxWaitSecs?: number;
}

interface PendingDeposit {
  partyAddress: string;
  member: string;
  amount: number;
  /** Serialized transaction message: exactly the bytes the member signs. */
  message: Uint8Array;
  blockhash: string;
  lastValidBlockHeight: number;
  createdAt: number;
}

const PENDING_DEPOSIT_TTL_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function shortvec(n: number): number[] {
  const out: number[] = [];
  let rem = n;
  for (;;) {
    const b = rem & 0x7f;
    rem >>= 7;
    if (rem === 0) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}

function toSafeNumber(v: bigint, what: string): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what} does not fit in a JS number`);
  return Number(v);
}

function assertAmount(amount: number, what: string, allowZero = false): void {
  if (!Number.isSafeInteger(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new Error(`${what} must be a ${allowZero ? 'non-negative' : 'positive'} integer of base units`);
  }
}

/**
 * Real settlement client for the huddle_vault program (PRD section 8). DEVNET ONLY.
 *
 * The treasury pays every fee and all rent, so the host key, the box key and the players never need
 * SOL. From the engine's point of view this behaves like `MockSettlementClient`: same methods, same
 * error messages for the same mistakes.
 */
export class VaultSettlementClient implements SettlementClient {
  readonly mode: 'vault' | 'trusted';
  readonly label: string;
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly mint: PublicKey;
  readonly cluster: string;

  private readonly treasury: Keypair;
  private readonly commitment: Commitment;
  private readonly finalizeMaxWaitSecs: number;
  private readonly pending = new Map<string, PendingDeposit>();
  private mintInfo?: Promise<{ decimals: number; treasuryIsMintAuthority: boolean }>;

  constructor(cfg: VaultClientConfig) {
    this.mode = cfg.mode;
    this.cluster = cfg.cluster ?? 'devnet';
    if (/mainnet/i.test(this.cluster) || /mainnet/i.test(cfg.rpcUrl)) {
      throw new Error('huddle_vault is devnet only: refusing to use a mainnet endpoint');
    }
    this.commitment = cfg.commitment ?? 'confirmed';
    this.connection = new Connection(cfg.rpcUrl, { commitment: this.commitment, wsEndpoint: cfg.wsUrl });
    this.programId = new PublicKey(cfg.programId);
    this.mint = new PublicKey(cfg.usdcMint);
    this.treasury = Keypair.fromSecretKey(keyPairFromSecret(cfg.treasurySecretKey).secretKey);
    this.finalizeMaxWaitSecs = cfg.finalizeMaxWaitSecs ?? 20;
    this.label = `Solana ${this.cluster} vault${cfg.mode === 'trusted' ? ' (trusted host)' : ''}`;
  }

  /** Treasury (fee payer + faucet) address, base58. */
  get treasuryAddress(): string {
    return this.treasury.publicKey.toBase58();
  }

  // ───────────────────────── addresses and reads ─────────────────────────

  /** The party PDA for a host + engine party id. */
  partyAddressFor(host: string, partyId: string): string {
    return findPartyPda(this.programId, new PublicKey(host), partyId)[0].toBase58();
  }

  async getParty(partyAddress: string): Promise<PartyAccount | null> {
    const info = await this.connection.getAccountInfo(new PublicKey(partyAddress), this.commitment);
    if (!info || !info.owner.equals(this.programId)) return null;
    return decodeParty(info.data);
  }

  async getMember(partyAddress: string, wallet: string): Promise<MemberAccount | null> {
    const [pda] = findMemberPda(this.programId, new PublicKey(partyAddress), new PublicKey(wallet));
    const info = await this.connection.getAccountInfo(pda, this.commitment);
    if (!info || !info.owner.equals(this.programId)) return null;
    return decodeMember(info.data);
  }

  /** Every Member account of a party (getProgramAccounts with a size + party filter). */
  async getMembers(partyAddress: string): Promise<MemberAccount[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      commitment: this.commitment,
      filters: [{ dataSize: MEMBER_ACCOUNT_SIZE }, { memcmp: { offset: MEMBER_PARTY_OFFSET, bytes: partyAddress } }],
    });
    return accounts.map((a) => decodeMember(a.account.data));
  }

  private async party(partyAddress: string): Promise<PartyAccount> {
    const p = await this.getParty(partyAddress);
    if (!p) throw new Error('party not found');
    return p;
  }

  private getMintInfo(): Promise<{ decimals: number; treasuryIsMintAuthority: boolean }> {
    this.mintInfo ??= (async () => {
      const info = await this.connection.getAccountInfo(this.mint, this.commitment);
      if (!info) throw new Error(`USDC_MINT ${this.mint.toBase58()} does not exist on ${this.cluster}`);
      const m = MintLayout.decode(info.data);
      return {
        decimals: m.decimals,
        treasuryIsMintAuthority: m.mintAuthorityOption === 1 && m.mintAuthority.equals(this.treasury.publicKey),
      };
    })();
    // Do not cache a failure (e.g. the RPC was briefly down).
    this.mintInfo.catch(() => (this.mintInfo = undefined));
    return this.mintInfo;
  }

  private async tokenBalance(tokenAccount: PublicKey): Promise<bigint> {
    const info = await this.connection.getAccountInfo(tokenAccount, this.commitment);
    if (!info || info.data.length < AccountLayout.span) return 0n;
    return AccountLayout.decode(info.data).amount;
  }

  // ───────────────────────── sending ─────────────────────────

  private async send(ixs: TransactionInstruction[], signers: Keypair[] = []): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.commitment);
    const tx = new Transaction({ feePayer: this.treasury.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    const unique = new Map<string, Keypair>([[this.treasury.publicKey.toBase58(), this.treasury]]);
    for (const s of signers) unique.set(s.publicKey.toBase58(), s);
    tx.sign(...unique.values());
    return this.sendRaw(tx.serialize(), blockhash, lastValidBlockHeight);
  }

  private async sendRaw(raw: Uint8Array, blockhash: string, lastValidBlockHeight: number): Promise<string> {
    let signature: string;
    try {
      signature = await this.connection.sendRawTransaction(raw, { preflightCommitment: this.commitment, maxRetries: 5 });
    } catch (e) {
      throw toVaultError(e);
    }
    let result;
    try {
      result = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, this.commitment);
    } catch (e) {
      throw toVaultError(e, signature);
    }
    if (result.value.err) throw toVaultError(result.value.err, signature);
    return signature;
  }

  /** Instructions that give `owner` `amount` USDC from the treasury (mint if we can, else transfer). */
  private async fundIxs(owner: PublicKey, amount: bigint): Promise<TransactionInstruction[]> {
    const { decimals, treasuryIsMintAuthority } = await this.getMintInfo();
    const ata = ataOf(this.mint, owner);
    const ixs = [createAssociatedTokenAccountIdempotentInstruction(this.treasury.publicKey, ata, owner, this.mint)];
    if (amount > 0n) {
      ixs.push(
        treasuryIsMintAuthority
          ? createMintToInstruction(this.mint, ata, this.treasury.publicKey, amount)
          : createTransferCheckedInstruction(
              ataOf(this.mint, this.treasury.publicKey),
              this.mint,
              ata,
              this.treasury.publicKey,
              amount,
              decimals,
            ),
      );
    }
    return ixs;
  }

  /** Top `owner` up to `needed` USDC from the treasury (devnet convenience for engine-held keys). */
  private async topUpIxs(owner: PublicKey, needed: bigint): Promise<TransactionInstruction[]> {
    const have = await this.tokenBalance(ataOf(this.mint, owner));
    return this.fundIxs(owner, needed > have ? needed - have : 0n);
  }

  // ───────────────────────── SettlementClient ─────────────────────────

  async createParty(params: CreatePartyParams): Promise<{ partyAddress: string; txSig?: string }> {
    assertAmount(params.bond, 'bond', true);
    const host = Keypair.fromSecretKey(keyPairFromSecret(params.hostSecretKey).secretKey);
    const partyId = partyIdBytes(params.partyId);
    const [party] = findPartyPda(this.programId, host.publicKey, partyId);
    const partyAddress = party.toBase58();

    // Idempotent: an engine restart may ask for the same party again.
    if (await this.getParty(partyAddress)) return { partyAddress };

    const ixs = await this.topUpIxs(host.publicKey, BigInt(params.bond));
    ixs.push(
      createPartyIx({
        programId: this.programId,
        payer: this.treasury.publicKey,
        host: host.publicKey,
        party,
        mint: this.mint,
        partyId,
        boxSigner: new PublicKey(params.boxSigner),
        challengeSecs: params.challengeSecs,
        bond: params.bond,
        requireMemberSig: params.requireMemberSig,
      }),
    );
    const txSig = await this.send(ixs, [host]);
    return { partyAddress, txSig };
  }

  async prepareDeposit(params: { partyAddress: string; member: string; amount: number }): Promise<DepositRequest> {
    assertAmount(params.amount, 'amount');
    const party = await this.party(params.partyAddress);
    if (party.status !== 'open') throw new Error('party is not open');
    const member = new PublicKey(params.member);
    const balance = await this.tokenBalance(ataOf(this.mint, member));
    if (balance < BigInt(params.amount)) {
      throw new Error(`insufficient USDC balance: wallet has ${balance} base units, deposit needs ${params.amount}`);
    }

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.commitment);
    const tx = new Transaction({ feePayer: this.treasury.publicKey, blockhash, lastValidBlockHeight }).add(
      depositIx({
        programId: this.programId,
        payer: this.treasury.publicKey,
        member,
        party: new PublicKey(params.partyAddress),
        mint: this.mint,
        amount: params.amount,
      }),
    );
    const message = tx.serializeMessage();

    const now = Date.now();
    for (const [id, d] of this.pending) if (now - d.createdAt > PENDING_DEPOSIT_TTL_MS) this.pending.delete(id);
    const depositId = randomId(8);
    this.pending.set(depositId, {
      partyAddress: params.partyAddress,
      member: params.member,
      amount: params.amount,
      message,
      blockhash,
      lastValidBlockHeight,
      createdAt: now,
    });
    return { depositId, messageB64: b64encode(message) };
  }

  async submitDeposit(params: { depositId: string; memberSignatureB64?: string }): Promise<{ txSig?: string; amount: number }> {
    const d = this.pending.get(params.depositId);
    if (!d) throw new Error('unknown deposit');
    if (!params.memberSignatureB64) throw new Error('member signature required');
    let memberSig: Uint8Array;
    try {
      memberSig = b64decode(params.memberSignatureB64);
    } catch {
      throw new Error('invalid member signature');
    }
    const memberKey = new PublicKey(d.member);
    if (memberSig.length !== 64 || !nacl.sign.detached.verify(d.message, memberSig, memberKey.toBytes())) {
      throw new Error('invalid member signature');
    }

    // Wire format: compact-u16 signature count | signatures in signer order | message.
    const msg = Message.from(d.message);
    const signatures: Uint8Array[] = [];
    for (let i = 0; i < msg.header.numRequiredSignatures; i++) {
      const key = msg.accountKeys[i] as PublicKey;
      if (key.equals(this.treasury.publicKey)) signatures.push(nacl.sign.detached(d.message, this.treasury.secretKey));
      else if (key.equals(memberKey)) signatures.push(memberSig);
      else throw new Error(`unexpected signer ${key.toBase58()} in deposit transaction`);
    }
    const head = shortvec(signatures.length);
    const raw = new Uint8Array(head.length + signatures.length * 64 + d.message.length);
    raw.set(head, 0);
    signatures.forEach((s, i) => raw.set(s, head.length + i * 64));
    raw.set(d.message, head.length + signatures.length * 64);

    // One shot: whatever happens the phone must ask for a fresh message (a new blockhash).
    this.pending.delete(params.depositId);
    const txSig = await this.sendRaw(raw, d.blockhash, d.lastValidBlockHeight);
    return { txSig, amount: d.amount };
  }

  async depositFromKey(params: { partyAddress: string; secretKey: Uint8Array; amount: number }): Promise<{ txSig?: string }> {
    assertAmount(params.amount, 'amount');
    const party = await this.party(params.partyAddress);
    if (party.status !== 'open') throw new Error('party is not open');
    const key = Keypair.fromSecretKey(keyPairFromSecret(params.secretKey).secretKey);
    // Engine-held key (the house): top it up from the treasury so this behaves like the mock.
    const ixs = await this.topUpIxs(key.publicKey, BigInt(params.amount));
    ixs.push(
      depositIx({
        programId: this.programId,
        payer: this.treasury.publicKey,
        member: key.publicKey,
        party: new PublicKey(params.partyAddress),
        mint: this.mint,
        amount: params.amount,
      }),
    );
    return { txSig: await this.send(ixs, [key]) };
  }

  async requestClose(partyAddress: string, signerSecretKey: Uint8Array): Promise<{ txSig?: string; challengeEndsAt: string }> {
    const partyKey = new PublicKey(partyAddress);
    let party = await this.party(partyAddress);
    const signer = Keypair.fromSecretKey(keyPairFromSecret(signerSecretKey).secretKey);
    const isHostOrBox = signer.publicKey.equals(party.host) || signer.publicKey.equals(party.boxSigner);
    let txSig: string | undefined;
    if (party.status === 'open') {
      const asMember = !isHostOrBox;
      if (asMember && !(await this.getMember(partyAddress, signer.publicKey.toBase58()))) {
        throw new Error('only the host or the box can close');
      }
      try {
        txSig = await this.send([requestCloseIx({ programId: this.programId, signer: signer.publicKey, party: partyKey, asMember })], [signer]);
      } catch (e) {
        // Someone else (a member, a second box tab) closed it first: that is fine.
        const now = await this.party(partyAddress);
        if (now.status === 'open') throw e;
      }
      party = await this.party(partyAddress);
    } else if (!isHostOrBox) {
      throw new Error('only the host or the box can close');
    }
    return { txSig, challengeEndsAt: new Date((party.closeRequestedAt + party.challengeSecs) * 1000).toISOString() };
  }

  async submitState(partyAddress: string, claim: SignedClaim): Promise<{ txSig?: string }> {
    const party = await this.party(partyAddress);
    if (party.status !== 'closing') throw new Error('party is not closing');
    const member = await this.getMember(partyAddress, claim.member);
    if (!member) throw new Error('not a member');
    assertAmount(claim.nonce, 'nonce', true);
    assertAmount(claim.balance, 'balance', true);

    const message = encodeStateMessage({
      party: partyAddress,
      member: claim.member,
      nonce: claim.nonce,
      balance: claim.balance,
      stateHash: claim.stateHash,
    });
    // Same checks the program makes, done first so a bad claim costs no transaction.
    if (!verifyBytes(message, claim.boxSig, party.boxSigner.toBase58())) throw new Error('invalid box signature');
    const signers = [{ publicKey: party.boxSigner.toBytes(), signature: b64decode(claim.boxSig) }];
    const memberSigOk = !!claim.memberSig && verifyBytes(message, claim.memberSig, claim.member);
    if (party.requireMemberSig && !memberSigOk) throw new Error('invalid member signature');
    if (memberSigOk) signers.push({ publicKey: new PublicKey(claim.member).toBytes(), signature: b64decode(claim.memberSig as string) });
    if (member.hasClaim && member.claimNonce >= BigInt(claim.nonce)) throw new Error('stale nonce');

    const txSig = await this.send([
      ed25519VerifyIx(signers, message),
      submitStateIx({
        programId: this.programId,
        party: new PublicKey(partyAddress),
        member: new PublicKey(claim.member),
        nonce: claim.nonce,
        balance: claim.balance,
        stateHash: hexDecode(claim.stateHash),
      }),
    ]);
    return { txSig };
  }

  /** Cluster time in unix seconds (the program compares against the Clock sysvar, not our clock). */
  private async chainTime(): Promise<number> {
    try {
      const slot = await this.connection.getSlot(this.commitment);
      const t = await this.connection.getBlockTime(slot);
      if (t) return t;
    } catch {
      /* fall through */
    }
    return Math.floor(Date.now() / 1000);
  }

  async finalize(partyAddress: string): Promise<{ txSig?: string; payouts: Record<string, number>; hostRefund: number }> {
    const partyKey = new PublicKey(partyAddress);
    let party = await this.party(partyAddress);
    if (party.status === 'open') throw new Error('party is not closing');

    let txSig: string | undefined;
    if (party.status === 'closing') {
      const endsAt = party.closeRequestedAt + party.challengeSecs;
      const deadline = Date.now() + this.finalizeMaxWaitSecs * 1000;
      const remaining = endsAt - (await this.chainTime());
      if (remaining > this.finalizeMaxWaitSecs) throw new Error('challenge window still open');
      if (remaining > 0) await sleep(remaining * 1000);

      const finalize = finalizeIx({ programId: this.programId, party: partyKey });
      const hostIx = withdrawHostIx({
        programId: this.programId,
        payer: this.treasury.publicKey,
        party: partyKey,
        host: party.host,
        mint: this.mint,
      });
      for (;;) {
        // Pay the host refund in the same transaction when there is one.
        const withHost = settleFromParty(party).hostRefund > 0n;
        try {
          txSig = await this.send(withHost ? [finalize, hostIx] : [finalize]);
          break;
        } catch (e) {
          const code = e instanceof VaultTxError ? e.code : undefined;
          party = await this.party(partyAddress);
          if (party.status === 'finalized') break; // somebody else finalized first
          if (code === 'ChallengeWindowOpen' && Date.now() < deadline) {
            await sleep(1000); // the Clock sysvar trails block time by a moment
            continue;
          }
          if (code === 'NothingToWithdraw' && Date.now() < deadline) continue; // a late claim removed the refund
          if (code === 'ChallengeWindowOpen') throw new Error('challenge window still open');
          throw e;
        }
      }
      party = await this.party(partyAddress);
    }
    if (party.status !== 'finalized') throw new Error('party is not finalized');

    const settlement: OnChainSettlement = {
      finalizedSum: party.finalizedSum,
      available: party.available,
      cut: party.cut,
      hostRefund: party.hostRefund,
    };
    const payouts: Record<string, number> = {};
    let paid = 0n;
    for (const m of await this.getMembers(partyAddress)) {
      const p = memberPayout(m, settlement);
      payouts[m.wallet.toBase58()] = toSafeNumber(p, 'payout');
      paid += p;
    }
    // Same definition as settleClaims: remaining bond + surplus + pro-rata rounding dust.
    return { txSig, payouts, hostRefund: toSafeNumber(party.available - paid, 'host refund') };
  }

  async withdraw(partyAddress: string, member: string): Promise<{ txSig?: string; amount: number }> {
    const partyKey = new PublicKey(partyAddress);
    const party = await this.party(partyAddress);
    if (party.status !== 'finalized') throw new Error('party is not finalized');
    const m = await this.getMember(partyAddress, member);
    if (!m) throw new Error('not a member');
    if (m.withdrawn) throw new Error('already withdrawn');
    const amount = memberPayout(m, party);
    const txSig = await this.send([
      withdrawIx({ programId: this.programId, payer: this.treasury.publicKey, party: partyKey, wallet: new PublicKey(member), mint: this.mint }),
    ]);
    // After the last member: sweep what is left (unpaid refund, pro-rata dust) to the host. Best effort.
    await this.withdrawHost(partyAddress).catch(() => undefined);
    return { txSig, amount: toSafeNumber(amount, 'payout') };
  }

  /**
   * Pay the host whatever it is owed right now (not part of `SettlementClient`; `finalize` and
   * `withdraw` call it for you). Resolves with amount 0 when there is nothing to pay yet.
   */
  async withdrawHost(partyAddress: string): Promise<{ txSig?: string; amount: number }> {
    const partyKey = new PublicKey(partyAddress);
    const party = await this.party(partyAddress);
    if (party.status !== 'finalized') throw new Error('party is not finalized');
    const allPaid = party.withdrawnCount === party.memberCount;
    const due = allPaid ? await this.tokenBalance(party.vault) : party.hostRefundPaid ? 0n : party.hostRefund;
    if (due === 0n) return { amount: 0 };
    const txSig = await this.send([
      withdrawHostIx({ programId: this.programId, payer: this.treasury.publicKey, party: partyKey, host: party.host, mint: this.mint }),
    ]);
    return { txSig, amount: toSafeNumber(due, 'host refund') };
  }

  async faucet(wallet: string, amount: number): Promise<{ txSig?: string }> {
    assertAmount(amount, 'amount');
    return { txSig: await this.send(await this.fundIxs(new PublicKey(wallet), BigInt(amount))) };
  }

  async walletBalance(wallet: string): Promise<number> {
    return toSafeNumber(await this.tokenBalance(ataOf(this.mint, new PublicKey(wallet))), 'balance');
  }

  /**
   * Program log subscription over RPC: the fallback path when QuickNode Streams is not configured.
   * Decodes the Anchor events in each successful transaction's logs into `ChainEvent`s (`via: "rpc"`).
   */
  subscribe(onEvent: (e: ChainEvent) => void): () => void {
    const programId = this.programId.toBase58();
    const seen = new Set<string>();
    const id = this.connection.onLogs(
      this.programId,
      (logs, ctx) => {
        if (logs.err || seen.has(logs.signature)) return;
        seen.add(logs.signature);
        if (seen.size > 5000) seen.delete(seen.values().next().value as string);
        for (const ev of parseHuddleLogs(logs.logs, programId)) {
          const ce = toChainEvent(ev);
          if (!ce) continue;
          try {
            onEvent({ ...ce, signature: logs.signature, slot: ctx.slot, via: 'rpc', explorerUrl: this.explorerUrl(logs.signature) });
          } catch (e) {
            console.warn('[solana-client] chain event listener threw:', e);
          }
        }
      },
      this.commitment,
    );
    return () => {
      void this.connection.removeOnLogsListener(id).catch(() => undefined);
    };
  }

  explorerUrl(txSig: string): string | undefined {
    if (this.cluster === 'localnet') {
      // Fixed URL on purpose: never put the configured RPC URL (it may carry an API token) in a link.
      return `https://explorer.solana.com/tx/${txSig}?cluster=custom&customUrl=${encodeURIComponent('http://localhost:8899')}`;
    }
    return `https://explorer.solana.com/tx/${txSig}?cluster=${this.cluster}`;
  }
}
