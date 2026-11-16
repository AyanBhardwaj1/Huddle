import { encodeStateMessage, hexEncode } from '@huddle/shared';
import {
  AccountLayout,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {
  DEFAULT_PROGRAM_ID,
  VaultTxError,
  ataOf,
  createPartyIx,
  decodeMember,
  decodeParty,
  depositIx,
  ed25519VerifyIx,
  findMemberPda,
  findPartyPda,
  findVaultPda,
  partyIdBytes,
  requestCloseIx,
  submitStateIx,
  toVaultError,
  type MemberAccount,
  type PartyAccount,
} from '../src';

/**
 * On-chain tests need a validator with huddle_vault loaded. `anchor test --validator legacy` sets
 * ANCHOR_PROVIDER_URL; set HUDDLE_LOCALNET_URL to point at a validator you started yourself.
 * Without either, these suites are skipped so `pnpm test` stays green.
 */
export const RPC_URL = process.env.HUDDLE_LOCALNET_URL || process.env.ANCHOR_PROVIDER_URL || '';
export const HAS_VALIDATOR = RPC_URL !== '';
export const PROGRAM_ID = new PublicKey(process.env.HUDDLE_PROGRAM_ID || DEFAULT_PROGRAM_ID);
export const USDC = 1_000_000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Ctx {
  conn: Connection;
  /** Fee payer, rent payer, mint authority: plays the treasury. */
  payer: Keypair;
  mint: PublicKey;
}

export async function send(ctx: Ctx, ixs: TransactionInstruction[], signers: Keypair[] = []): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await ctx.conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: ctx.payer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  const unique = new Map<string, Keypair>([[ctx.payer.publicKey.toBase58(), ctx.payer]]);
  for (const s of signers) unique.set(s.publicKey.toBase58(), s);
  tx.sign(...unique.values());
  let sig: string;
  try {
    sig = await ctx.conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
  } catch (e) {
    throw toVaultError(e);
  }
  const res = await ctx.conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (res.value.err) throw toVaultError(res.value.err, sig);
  return sig;
}

/** Resolves with the decoded failure of a transaction that must fail. */
export async function failure(p: Promise<unknown>): Promise<VaultTxError> {
  try {
    await p;
  } catch (e) {
    return toVaultError(e);
  }
  throw new Error('expected the transaction to fail, but it succeeded');
}

export async function airdrop(conn: Connection, to: PublicKey, sol: number): Promise<void> {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash('confirmed');
  await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
}

/** Fresh payer with SOL and a fresh 6-decimal test mint it controls. */
export async function setup(): Promise<Ctx> {
  const conn = new Connection(RPC_URL, 'confirmed');
  const payer = Keypair.generate();
  await airdrop(conn, payer.publicKey, 100);
  const mintKp = Keypair.generate();
  const ctx: Ctx = { conn, payer, mint: mintKp.publicKey };
  await send(
    ctx,
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mintKp.publicKey, 6, payer.publicKey, null),
    ],
    [mintKp],
  );
  return ctx;
}

/** Mint test USDC to a wallet's associated token account (creating it; the wallet needs no SOL). */
export async function fund(ctx: Ctx, wallet: PublicKey, amount: number): Promise<void> {
  const ata = ataOf(ctx.mint, wallet);
  const ixs = [createAssociatedTokenAccountIdempotentInstruction(ctx.payer.publicKey, ata, wallet, ctx.mint)];
  if (amount > 0) ixs.push(createMintToInstruction(ctx.mint, ata, ctx.payer.publicKey, amount));
  await send(ctx, ixs);
}

export async function tokenBalance(ctx: Ctx, tokenAccount: PublicKey): Promise<number> {
  const info = await ctx.conn.getAccountInfo(tokenAccount, 'confirmed');
  if (!info) return 0;
  return Number(AccountLayout.decode(info.data).amount);
}
export const usdcOf = (ctx: Ctx, wallet: PublicKey) => tokenBalance(ctx, ataOf(ctx.mint, wallet));

export interface TestParty {
  host: Keypair;
  box: Keypair;
  party: PublicKey;
  vault: PublicKey;
  bond: number;
}

let partySeq = 0;

export async function createParty(
  ctx: Ctx,
  opts: { bond?: number; challengeSecs?: number; requireMemberSig?: boolean } = {},
): Promise<TestParty> {
  const host = Keypair.generate();
  const box = Keypair.generate();
  const bond = opts.bond ?? 5 * USDC;
  const partyId = partyIdBytes(`test-${Date.now()}-${partySeq++}`);
  const [party] = findPartyPda(PROGRAM_ID, host.publicKey, partyId);
  const [vault] = findVaultPda(PROGRAM_ID, party);
  await fund(ctx, host.publicKey, bond);
  await send(
    ctx,
    [
      createPartyIx({
        programId: PROGRAM_ID,
        payer: ctx.payer.publicKey,
        host: host.publicKey,
        party,
        mint: ctx.mint,
        partyId,
        boxSigner: box.publicKey,
        challengeSecs: opts.challengeSecs ?? 2,
        bond,
        requireMemberSig: opts.requireMemberSig ?? true,
      }),
    ],
    [host],
  );
  return { host, box, party, vault, bond };
}

/** New member wallet (no SOL), funded with test USDC, deposited into the party. */
export async function join(ctx: Ctx, p: TestParty, amount: number): Promise<Keypair> {
  const member = Keypair.generate();
  await fund(ctx, member.publicKey, amount);
  await deposit(ctx, p, member, amount);
  return member;
}

export function deposit(ctx: Ctx, p: TestParty, member: Keypair, amount: number): Promise<string> {
  return send(
    ctx,
    [depositIx({ programId: PROGRAM_ID, payer: ctx.payer.publicKey, member: member.publicKey, party: p.party, mint: ctx.mint, amount })],
    [member],
  );
}

export function requestClose(ctx: Ctx, p: TestParty, signer: Keypair, asMember = false): Promise<string> {
  return send(ctx, [requestCloseIx({ programId: PROGRAM_ID, signer: signer.publicKey, party: p.party, asMember })], [signer]);
}

export async function getParty(ctx: Ctx, party: PublicKey): Promise<PartyAccount> {
  const info = await ctx.conn.getAccountInfo(party, 'confirmed');
  if (!info) throw new Error('party account missing');
  return decodeParty(info.data);
}

export async function getMember(ctx: Ctx, party: PublicKey, wallet: PublicKey): Promise<MemberAccount> {
  const info = await ctx.conn.getAccountInfo(findMemberPda(PROGRAM_ID, party, wallet)[0], 'confirmed');
  if (!info) throw new Error('member account missing');
  return decodeMember(info.data);
}

export async function chainTime(ctx: Ctx): Promise<number> {
  const t = await ctx.conn.getBlockTime(await ctx.conn.getSlot('confirmed'));
  return t ?? Math.floor(Date.now() / 1000);
}

/** Wait until the cluster clock is past the party's challenge window. */
export async function waitForWindow(ctx: Ctx, party: PublicKey): Promise<void> {
  const p = await getParty(ctx, party);
  const endsAt = p.closeRequestedAt + p.challengeSecs;
  while ((await chainTime(ctx)) <= endsAt) await sleep(400);
}

export interface StateFields {
  party: PublicKey;
  member: PublicKey;
  nonce: number;
  balance: number;
  stateHash?: Uint8Array;
}

export function stateMessage(f: StateFields): Uint8Array {
  return encodeStateMessage({
    party: f.party.toBase58(),
    member: f.member.toBase58(),
    nonce: f.nonce,
    balance: f.balance,
    stateHash: hexEncode(f.stateHash ?? new Uint8Array(32).fill(7)),
  });
}

export function sigOver(message: Uint8Array, signer: Keypair): { publicKey: Uint8Array; signature: Uint8Array } {
  return { publicKey: signer.publicKey.toBytes(), signature: nacl.sign.detached(message, signer.secretKey) };
}

export function submitIx(f: StateFields): TransactionInstruction {
  return submitStateIx({
    programId: PROGRAM_ID,
    party: f.party,
    member: f.member,
    nonce: f.nonce,
    balance: f.balance,
    stateHash: f.stateHash ?? new Uint8Array(32).fill(7),
  });
}

/** A correctly signed claim: one Ed25519 instruction carrying every signature + submit_state. */
export function submitState(ctx: Ctx, f: StateFields, signers: Keypair[]): Promise<string> {
  const message = stateMessage(f);
  return send(ctx, [ed25519VerifyIx(signers.map((s) => sigOver(message, s)), message), submitIx(f)]);
}
