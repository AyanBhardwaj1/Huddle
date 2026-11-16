import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { BalanceState, LedgerEntry } from './types';

/**
 * Signed balance message (PRD section 8). Canonical bytes, little-endian integers:
 *
 *   "HUDDLE_STATE_V1" (15) || party (32) || member (32) || nonce u64 || balance u64 || state_hash (32)
 *
 * 127 bytes total. Signed with ed25519 by the box signer and by the member's wallet key.
 */
export const STATE_DOMAIN = 'HUDDLE_STATE_V1';
export const STATE_MESSAGE_LEN = 15 + 32 + 32 + 8 + 8 + 32;
export const ZERO_HASH = '0'.repeat(64);

const enc = new TextEncoder();

// ---------- encoding helpers ----------

export function b58encode(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}
export function b58decode(s: string): Uint8Array {
  return bs58.decode(s);
}
export function hexEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
export function hexDecode(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('bad hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function u64le(n: number | bigint): Uint8Array {
  const v = BigInt(n);
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new Error('u64 out of range');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

// ---------- state message ----------

export interface StateMessageFields {
  /** Party address, base58 (32 bytes). */
  party: string;
  /** Member wallet, base58 (32 bytes). */
  member: string;
  nonce: number | bigint;
  /** USDC base units. */
  balance: number | bigint;
  /** Hex sha256 (32 bytes). */
  stateHash: string;
}

export function encodeStateMessage(f: StateMessageFields): Uint8Array {
  const party = b58decode(f.party);
  const member = b58decode(f.member);
  const hash = hexDecode(f.stateHash);
  if (party.length !== 32) throw new Error('party must be 32 bytes');
  if (member.length !== 32) throw new Error('member must be 32 bytes');
  if (hash.length !== 32) throw new Error('stateHash must be 32 bytes');
  const out = new Uint8Array(STATE_MESSAGE_LEN);
  let o = 0;
  out.set(enc.encode(STATE_DOMAIN), o);
  o += 15;
  out.set(party, o);
  o += 32;
  out.set(member, o);
  o += 32;
  out.set(u64le(f.nonce), o);
  o += 8;
  out.set(u64le(f.balance), o);
  o += 8;
  out.set(hash, o);
  return out;
}

export function decodeStateMessage(msg: Uint8Array): StateMessageFields {
  if (msg.length !== STATE_MESSAGE_LEN) throw new Error('bad state message length');
  const domain = new TextDecoder().decode(msg.slice(0, 15));
  if (domain !== STATE_DOMAIN) throw new Error('bad domain');
  const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  return {
    party: b58encode(msg.slice(15, 47)),
    member: b58encode(msg.slice(47, 79)),
    nonce: dv.getBigUint64(79, true),
    balance: dv.getBigUint64(87, true),
    stateHash: hexEncode(msg.slice(95, 127)),
  };
}

/**
 * Audit-trail hash: sha256(prevHash(32) || utf8(canonical JSON of the entries since the last state)).
 * Canonical JSON = array of [seq, type, marketId ?? "", amount, memo ?? ""].
 */
export function hashLedger(prevHashHex: string, entries: LedgerEntry[]): string {
  const canonical = JSON.stringify(entries.map((e) => [e.seq, e.type, e.marketId ?? '', e.amount, e.memo ?? '']));
  const prev = hexDecode(prevHashHex);
  const body = enc.encode(canonical);
  const buf = new Uint8Array(prev.length + body.length);
  buf.set(prev, 0);
  buf.set(body, prev.length);
  return hexEncode(sha256(buf));
}

// ---------- keys and signatures ----------

export interface KeyPair {
  /** base58 public key */
  publicKey: string;
  /** 64-byte ed25519 secret key (Solana keypair format) */
  secretKey: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  const kp = nacl.sign.keyPair();
  return { publicKey: b58encode(kp.publicKey), secretKey: kp.secretKey };
}

export function keyPairFromSecret(secretKey: Uint8Array): KeyPair {
  const kp =
    secretKey.length === 32 ? nacl.sign.keyPair.fromSeed(secretKey) : nacl.sign.keyPair.fromSecretKey(secretKey);
  return { publicKey: b58encode(kp.publicKey), secretKey: kp.secretKey };
}

/** Parse a secret key from a JSON byte array ("[1,2,...]", Solana CLI format), base58, or base64. */
export function parseSecretKey(s: string): Uint8Array {
  const t = s.trim();
  if (t.startsWith('[')) return Uint8Array.from(JSON.parse(t) as number[]);
  try {
    const b = b58decode(t);
    if (b.length === 64 || b.length === 32) return b;
  } catch {
    /* fall through */
  }
  const b = b64decode(t);
  if (b.length === 64 || b.length === 32) return b;
  throw new Error('unrecognized secret key format');
}

export function signBytes(message: Uint8Array, secretKey: Uint8Array): string {
  return b64encode(nacl.sign.detached(message, secretKey));
}

export function verifyBytes(message: Uint8Array, signatureB64: string, publicKeyB58: string): boolean {
  try {
    return nacl.sign.detached.verify(message, b64decode(signatureB64), b58decode(publicKeyB58));
  } catch {
    return false;
  }
}

export function signState(f: StateMessageFields, secretKey: Uint8Array): string {
  return signBytes(encodeStateMessage(f), secretKey);
}

export function verifyStateSig(f: StateMessageFields, signatureB64: string, signerB58: string): boolean {
  return verifyBytes(encodeStateMessage(f), signatureB64, signerB58);
}

export type StateCheck = { ok: true } | { ok: false; reason: string };

/**
 * What a player's phone checks before countersigning (PRD section 8):
 *  1. the box signature is valid for exactly this (party, member, nonce, balance, hash);
 *  2. the nonce moves forward by one and chains from the state we last signed;
 *  3. prevBalance + sum(entries) == balance;
 *  4. the state hash matches the entries we were shown.
 */
export function checkBalanceState(
  state: BalanceState,
  party: string,
  boxSigner: string,
  prev: Pick<BalanceState, 'nonce' | 'balance' | 'stateHash'> | null,
): StateCheck {
  const fields = { party, member: state.member, nonce: state.nonce, balance: state.balance, stateHash: state.stateHash };
  if (state.balance < 0) return { ok: false, reason: 'negative balance' };
  if (!verifyStateSig(fields, state.boxSig, boxSigner)) return { ok: false, reason: 'bad box signature' };
  const prevNonce = prev?.nonce ?? 0;
  const prevBalance = prev?.balance ?? 0;
  const prevHash = prev?.stateHash ?? ZERO_HASH;
  if (state.nonce !== prevNonce + 1) return { ok: false, reason: `nonce gap (have ${prevNonce}, got ${state.nonce})` };
  if (state.prevBalance !== prevBalance) return { ok: false, reason: 'previous balance mismatch' };
  if (state.prevStateHash !== prevHash) return { ok: false, reason: 'previous hash mismatch' };
  const sum = state.entries.reduce((a, e) => a + e.amount, 0);
  if (prevBalance + sum !== state.balance) return { ok: false, reason: 'entries do not add up to the balance' };
  if (hashLedger(prevHash, state.entries) !== state.stateHash) return { ok: false, reason: 'state hash mismatch' };
  return { ok: true };
}

// ---------- session challenge ----------

/** Message a client signs to bind a WebSocket session to its pubkey. */
export function joinChallengeMessage(challenge: string, partyCode: string): Uint8Array {
  return enc.encode(`HUDDLE_JOIN_V1|${challenge}|${partyCode.toUpperCase()}`);
}

export function randomId(bytes = 8): string {
  return hexEncode(nacl.randomBytes(bytes));
}
