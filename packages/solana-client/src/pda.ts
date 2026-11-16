import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

/** Program id baked into the build (`declare_id!`). Override with HUDDLE_PROGRAM_ID. */
export const DEFAULT_PROGRAM_ID = 'GRpABdrQhDya9n2zuf19w2idbL3CRSqmWYTJs52taRHu';

export const PARTY_SEED = Buffer.from('party');
export const MEMBER_SEED = Buffer.from('member');
export const VAULT_SEED = Buffer.from('vault');

/**
 * The on-chain `party_id` is 32 opaque bytes. The engine's party id is a string, so:
 *  - up to 32 UTF-8 bytes: the bytes, zero-padded on the right (readable in an explorer);
 *  - longer: sha256 of the UTF-8 bytes.
 */
export function partyIdBytes(partyId: string): Uint8Array {
  const utf8 = Buffer.from(partyId, 'utf8');
  if (utf8.length === 0) throw new Error('partyId must not be empty');
  if (utf8.length > 32) return new Uint8Array(createHash('sha256').update(utf8).digest());
  const out = new Uint8Array(32);
  out.set(utf8);
  return out;
}

/** Party PDA: seeds ["party", host, party_id]. */
export function findPartyPda(programId: PublicKey, host: PublicKey, partyId: string | Uint8Array): [PublicKey, number] {
  const id = typeof partyId === 'string' ? partyIdBytes(partyId) : partyId;
  return PublicKey.findProgramAddressSync([PARTY_SEED, host.toBuffer(), Buffer.from(id)], programId);
}

/** Member PDA: seeds ["member", party, wallet]. */
export function findMemberPda(programId: PublicKey, party: PublicKey, wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MEMBER_SEED, party.toBuffer(), wallet.toBuffer()], programId);
}

/** Vault token account PDA: seeds ["vault", party]. Owned (token authority) by the Party PDA. */
export function findVaultPda(programId: PublicKey, party: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_SEED, party.toBuffer()], programId);
}
