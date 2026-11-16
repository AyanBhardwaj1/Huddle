import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { INSTRUCTION_DISCRIMINATORS, type HuddleInstructionName } from './decode';
import { findMemberPda, findVaultPda } from './pda';

/**
 * Hand-rolled huddle_vault instruction builders (Anchor wire format: 8-byte discriminator + Borsh
 * args, accounts in the order of the Rust `#[derive(Accounts)]` structs). Unit tests check them
 * against the IDL in `./idl/huddle_vault.json`.
 */

function u64le(n: bigint | number): Buffer {
  const v = BigInt(n);
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new Error('u64 out of range');
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function u32le(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error('u32 out of range');
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function disc(name: HuddleInstructionName): Buffer {
  return Buffer.from(INSTRUCTION_DISCRIMINATORS[name]);
}
const ro = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const rw = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });

export function ataOf(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

export function createPartyIx(p: {
  programId: PublicKey;
  payer: PublicKey;
  host: PublicKey;
  party: PublicKey;
  mint: PublicKey;
  /** Token account the bond is taken from. Defaults to the host's associated token account. */
  hostToken?: PublicKey;
  partyId: Uint8Array;
  boxSigner: PublicKey;
  challengeSecs: number;
  bond: bigint | number;
  requireMemberSig: boolean;
}): TransactionInstruction {
  if (p.partyId.length !== 32) throw new Error('partyId must be 32 bytes');
  const [vault] = findVaultPda(p.programId, p.party);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      rw(p.payer, true),
      ro(p.host, true),
      rw(p.party),
      ro(p.mint),
      rw(vault),
      rw(p.hostToken ?? ataOf(p.mint, p.host)),
      ro(TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
    ],
    data: Buffer.concat([
      disc('create_party'),
      Buffer.from(p.partyId),
      p.boxSigner.toBuffer(),
      u32le(p.challengeSecs),
      u64le(p.bond),
      Buffer.from([p.requireMemberSig ? 1 : 0]),
    ]),
  });
}

export function depositIx(p: {
  programId: PublicKey;
  payer: PublicKey;
  member: PublicKey;
  party: PublicKey;
  mint: PublicKey;
  /** Defaults to the member's associated token account. */
  memberToken?: PublicKey;
  amount: bigint | number;
}): TransactionInstruction {
  const [memberAccount] = findMemberPda(p.programId, p.party, p.member);
  const [vault] = findVaultPda(p.programId, p.party);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      rw(p.payer, true),
      ro(p.member, true),
      rw(p.party),
      rw(memberAccount),
      ro(p.mint),
      rw(p.memberToken ?? ataOf(p.mint, p.member)),
      rw(vault),
      ro(TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
    ],
    data: Buffer.concat([disc('deposit'), u64le(p.amount)]),
  });
}

export function requestCloseIx(p: {
  programId: PublicKey;
  signer: PublicKey;
  party: PublicKey;
  /** True when the signer is a plain member (not the host or the box): passes its Member account. */
  asMember?: boolean;
}): TransactionInstruction {
  // Anchor encodes a missing optional account as the program id.
  const memberAccount = p.asMember ? findMemberPda(p.programId, p.party, p.signer)[0] : p.programId;
  return new TransactionInstruction({
    programId: p.programId,
    keys: [ro(p.signer, true), rw(p.party), ro(memberAccount)],
    data: disc('request_close'),
  });
}

export function submitStateIx(p: {
  programId: PublicKey;
  party: PublicKey;
  member: PublicKey;
  nonce: bigint | number;
  balance: bigint | number;
  stateHash: Uint8Array;
}): TransactionInstruction {
  if (p.stateHash.length !== 32) throw new Error('stateHash must be 32 bytes');
  const [memberAccount] = findMemberPda(p.programId, p.party, p.member);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [rw(p.party), rw(memberAccount), ro(SYSVAR_INSTRUCTIONS_PUBKEY)],
    data: Buffer.concat([disc('submit_state'), p.member.toBuffer(), u64le(p.nonce), u64le(p.balance), Buffer.from(p.stateHash)]),
  });
}

export function finalizeIx(p: { programId: PublicKey; party: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({ programId: p.programId, keys: [rw(p.party)], data: disc('finalize') });
}

export function withdrawIx(p: {
  programId: PublicKey;
  payer: PublicKey;
  party: PublicKey;
  wallet: PublicKey;
  mint: PublicKey;
}): TransactionInstruction {
  const [memberAccount] = findMemberPda(p.programId, p.party, p.wallet);
  const [vault] = findVaultPda(p.programId, p.party);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      rw(p.payer, true),
      rw(p.party),
      rw(memberAccount),
      ro(p.wallet),
      ro(p.mint),
      rw(vault),
      rw(ataOf(p.mint, p.wallet)),
      ro(TOKEN_PROGRAM_ID),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
    ],
    data: disc('withdraw'),
  });
}

export function withdrawHostIx(p: {
  programId: PublicKey;
  payer: PublicKey;
  party: PublicKey;
  host: PublicKey;
  mint: PublicKey;
}): TransactionInstruction {
  const [vault] = findVaultPda(p.programId, p.party);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      rw(p.payer, true),
      rw(p.party),
      ro(p.host),
      ro(p.mint),
      rw(vault),
      rw(ataOf(p.mint, p.host)),
      ro(TOKEN_PROGRAM_ID),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
    ],
    data: disc('withdraw_host'),
  });
}

// ───────────────────────── Ed25519 signature-verify instruction ─────────────────────────

const ED25519_HEADER = 2;
const ED25519_OFFSETS = 14;
/** "This instruction" marker for the *_instruction_index fields. */
const SELF = 0xffff;

/**
 * One native Ed25519 program instruction that verifies several signatures over the SAME message.
 * Layout: header (count, padding) | 14-byte offset block per signature | per signature: pubkey(32) +
 * signature(64) | message. Every offset points into this instruction's own data (index 0xffff),
 * which is what huddle_vault requires.
 */
export function ed25519VerifyIx(signers: { publicKey: Uint8Array; signature: Uint8Array }[], message: Uint8Array): TransactionInstruction {
  if (signers.length === 0 || signers.length > 255) throw new Error('need 1..255 signatures');
  const n = signers.length;
  const keysStart = ED25519_HEADER + n * ED25519_OFFSETS;
  const messageOffset = keysStart + n * (32 + 64);
  const data = Buffer.alloc(messageOffset + message.length);
  data.writeUInt8(n, 0);
  data.writeUInt8(0, 1);
  signers.forEach((s, i) => {
    if (s.publicKey.length !== 32) throw new Error('public key must be 32 bytes');
    if (s.signature.length !== 64) throw new Error('signature must be 64 bytes');
    const pkOffset = keysStart + i * (32 + 64);
    const sigOffset = pkOffset + 32;
    const o = ED25519_HEADER + i * ED25519_OFFSETS;
    data.writeUInt16LE(sigOffset, o);
    data.writeUInt16LE(SELF, o + 2);
    data.writeUInt16LE(pkOffset, o + 4);
    data.writeUInt16LE(SELF, o + 6);
    data.writeUInt16LE(messageOffset, o + 8);
    data.writeUInt16LE(message.length, o + 10);
    data.writeUInt16LE(SELF, o + 12);
    data.set(s.publicKey, pkOffset);
    data.set(s.signature, sigOffset);
  });
  data.set(message, messageOffset);
  return new TransactionInstruction({ programId: Ed25519Program.programId, keys: [], data });
}
