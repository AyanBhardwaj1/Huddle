/**
 * Pure, dependency-free decoders for huddle_vault instructions and events.
 *
 * ZERO IMPORTS ON PURPOSE: this file is meant to be copied into a QuickNode Streams filter function
 * (plain JS, strip the type annotations) as well as used by `subscribe()` in this package.
 *
 *  - `decodeHuddleInstruction(data, accountKeys)`: Anchor instruction discriminator -> name, party PDA,
 *    member and amount, from the raw instruction data and the instruction's account keys.
 *  - `decodeHuddleEvent(base64)`: one Anchor event from a `Program data: <base64>` log line.
 *  - `parseHuddleLogs(logs, programId)`: every huddle_vault event in a transaction's log messages.
 *  - `toChainEvent(...)`: normalized `ChainEvent` fields (kind / partyAddress / member / amount).
 */

export type HuddleInstructionName =
  | 'create_party'
  | 'deposit'
  | 'request_close'
  | 'submit_state'
  | 'finalize'
  | 'withdraw'
  | 'withdraw_host';

export type HuddleEventName =
  | 'PartyCreated'
  | 'Deposited'
  | 'CloseRequested'
  | 'StateSubmitted'
  | 'Finalized'
  | 'Withdrawn'
  | 'HostWithdrawn';

/** Anchor instruction discriminators: sha256("global:<name>")[0..8]. */
export const INSTRUCTION_DISCRIMINATORS: Record<HuddleInstructionName, readonly number[]> = {
  create_party: [251, 84, 246, 151, 106, 204, 201, 22],
  deposit: [242, 35, 198, 137, 82, 225, 242, 182],
  request_close: [82, 168, 167, 86, 14, 15, 199, 180],
  submit_state: [172, 31, 42, 160, 233, 237, 4, 251],
  finalize: [171, 61, 218, 56, 127, 115, 12, 217],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
  withdraw_host: [103, 247, 115, 166, 187, 165, 7, 18],
};

/** Anchor event discriminators: sha256("event:<Name>")[0..8]. */
export const EVENT_DISCRIMINATORS: Record<HuddleEventName, readonly number[]> = {
  PartyCreated: [181, 103, 87, 221, 198, 141, 108, 58],
  Deposited: [111, 141, 26, 45, 161, 35, 100, 57],
  CloseRequested: [136, 120, 170, 78, 168, 236, 47, 118],
  StateSubmitted: [31, 198, 220, 75, 236, 240, 237, 143],
  Finalized: [4, 77, 242, 80, 20, 152, 247, 252],
  Withdrawn: [20, 89, 223, 198, 194, 124, 219, 13],
  HostWithdrawn: [164, 59, 177, 93, 165, 174, 170, 117],
};

/**
 * Where things sit in each instruction's account list (same order as the Rust `#[derive(Accounts)]`
 * structs and the IDL). `member: -1` = not in the accounts (see `memberFromData`).
 *
 *   create_party : payer, host, party, mint, vault, host_token, token_program, system_program
 *   deposit      : payer, member, party, member_account, mint, member_token, vault, token_program, system_program
 *   request_close: signer, party, member_account?
 *   submit_state : party, member_account, instructions_sysvar           (member is in the data)
 *   finalize     : party
 *   withdraw     : payer, party, member_account, wallet, mint, vault, wallet_token, token_program, ata_program, system_program
 *   withdraw_host: payer, party, host, mint, vault, host_token, token_program, ata_program, system_program
 */
export const INSTRUCTION_LAYOUT: Record<
  HuddleInstructionName,
  { party: number; member: number; memberFromData?: number; amountFromData?: number }
> = {
  // member = the host; amount = bond (after party_id[32], box_signer[32], challenge_secs u32)
  create_party: { party: 2, member: 1, amountFromData: 8 + 32 + 32 + 4 },
  deposit: { party: 2, member: 1, amountFromData: 8 },
  // member = whoever signed the close (host, box signer or a member)
  request_close: { party: 1, member: 0 },
  // data: member[32], nonce u64, balance u64, state_hash[32]; amount = the claimed balance
  submit_state: { party: 0, member: -1, memberFromData: 8, amountFromData: 8 + 32 + 8 },
  finalize: { party: 0, member: -1 },
  // The payout is computed on-chain: read it from the `Withdrawn` event (or the token balance change).
  withdraw: { party: 1, member: 3 },
  withdraw_host: { party: 1, member: 2 },
};

export interface DecodedHuddleInstruction {
  instruction: HuddleInstructionName;
  /** Party PDA, base58. */
  partyPda: string;
  /** Member wallet (host for create_party / withdraw_host, signer for request_close), base58. */
  member?: string;
  /** USDC base units: bond (create_party), deposit amount, claimed balance (submit_state). */
  amount?: number;
  /** submit_state only. */
  nonce?: number;
}

export interface DecodedHuddleEvent {
  name: HuddleEventName;
  /** Party PDA, base58. Every event starts with it. */
  party: string;
  /** Member wallet (or host / closer), base58. Absent on nothing: every event has a second pubkey. */
  member?: string;
  /** USDC base units: bond, deposit, claimed balance, host refund, payout. */
  amount?: number;
  /** Event-specific extras (unix seconds, flags, sums as decimal strings when they may exceed 2^53). */
  extra: Record<string, number | string | boolean>;
}

// ───────────────────────── tiny byte helpers (no Buffer, no deps) ─────────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i] as number;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i] as number];
  return out;
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    let carry = B58.indexOf(s[i] as string);
    if (carry < 0) throw new Error('invalid base58 character');
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] as number) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i] as number;
  return out;
}

export function base64Decode(s: string): Uint8Array {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buf = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = A.indexOf(clean[i] as string);
    if (v < 0) throw new Error('invalid base64 character');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Little-endian unsigned integer of `len` bytes as a JS number (exact up to 2^53). */
function readUintLE(b: Uint8Array, at: number, len: number): number {
  let v = 0;
  for (let i = len - 1; i >= 0; i--) v = v * 256 + (b[at + i] as number);
  return v;
}

/** Little-endian unsigned integer as a decimal string (for u128 sums). */
function readUintLEString(b: Uint8Array, at: number, len: number): string {
  let v = 0n;
  for (let i = len - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[at + i] as number);
  return v.toString();
}

function hasPrefix(data: Uint8Array, prefix: readonly number[]): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

function toBytes(data: Uint8Array | string): Uint8Array {
  // JSON-RPC `getBlock` / `getTransaction` (encoding "json") give instruction data as base58.
  return typeof data === 'string' ? base58Decode(data) : data;
}

// ───────────────────────── instructions ─────────────────────────

/**
 * Decode one huddle_vault instruction.
 *
 * @param data        raw instruction data (bytes, or the base58 string from JSON-RPC)
 * @param accountKeys the instruction's accounts, base58, in instruction order (i.e. already resolved
 *                    from the message's account indexes: `ix.accounts.map(i => message.accountKeys[i])`)
 * @returns null when the data does not start with a huddle_vault discriminator
 */
export function decodeHuddleInstruction(
  data: Uint8Array | string,
  accountKeys: readonly string[],
): DecodedHuddleInstruction | null {
  let bytes: Uint8Array;
  try {
    bytes = toBytes(data);
  } catch {
    return null;
  }
  for (const name of Object.keys(INSTRUCTION_DISCRIMINATORS) as HuddleInstructionName[]) {
    if (!hasPrefix(bytes, INSTRUCTION_DISCRIMINATORS[name])) continue;
    const layout = INSTRUCTION_LAYOUT[name];
    const partyPda = accountKeys[layout.party];
    if (!partyPda) return null;
    const out: DecodedHuddleInstruction = { instruction: name, partyPda };
    if (layout.member >= 0 && accountKeys[layout.member]) out.member = accountKeys[layout.member];
    if (layout.memberFromData !== undefined && bytes.length >= layout.memberFromData + 32) {
      out.member = base58Encode(bytes.subarray(layout.memberFromData, layout.memberFromData + 32));
    }
    if (layout.amountFromData !== undefined && bytes.length >= layout.amountFromData + 8) {
      out.amount = readUintLE(bytes, layout.amountFromData, 8);
    }
    if (name === 'submit_state' && bytes.length >= 8 + 32 + 8) out.nonce = readUintLE(bytes, 8 + 32, 8);
    return out;
  }
  return null;
}

// ───────────────────────── events ─────────────────────────

/**
 * Decode one Anchor event emitted by huddle_vault. `data` is the payload of a `Program data: ` log
 * line (base64) or its bytes. Event layouts (after the 8-byte discriminator), all little-endian:
 *
 *   PartyCreated  : party, host, box_signer, mint, vault, party_id[32], bond u64, challenge_secs u32, require_member_sig u8
 *   Deposited     : party, member, amount u64, member_deposited u64, total_deposits u64
 *   CloseRequested: party, by, close_requested_at i64, challenge_ends_at i64
 *   StateSubmitted: party, member, balance u64, nonce u64, state_hash[32]
 *   Finalized     : party, host, host_refund u64, total_deposits u64, bond u64, available u64, finalized_sum u128, cut u8
 *   Withdrawn     : party, member, amount u64
 *   HostWithdrawn : party, host, amount u64
 */
export function decodeHuddleEvent(data: Uint8Array | string): DecodedHuddleEvent | null {
  let b: Uint8Array;
  try {
    b = typeof data === 'string' ? base64Decode(data) : data;
  } catch {
    return null;
  }
  for (const name of Object.keys(EVENT_DISCRIMINATORS) as HuddleEventName[]) {
    if (!hasPrefix(b, EVENT_DISCRIMINATORS[name])) continue;
    if (b.length < 8 + 64) return null;
    const party = base58Encode(b.subarray(8, 40));
    const second = base58Encode(b.subarray(40, 72));
    const ev: DecodedHuddleEvent = { name, party, member: second, extra: {} };
    switch (name) {
      case 'PartyCreated':
        if (b.length < 8 + 32 * 6 + 13) return null;
        ev.amount = readUintLE(b, 200, 8);
        ev.extra = {
          boxSigner: base58Encode(b.subarray(72, 104)),
          mint: base58Encode(b.subarray(104, 136)),
          vault: base58Encode(b.subarray(136, 168)),
          challengeSecs: readUintLE(b, 208, 4),
          requireMemberSig: b[212] === 1,
        };
        break;
      case 'Deposited':
        if (b.length < 72 + 24) return null;
        ev.amount = readUintLE(b, 72, 8);
        ev.extra = { memberDeposited: readUintLE(b, 80, 8), totalDeposits: readUintLE(b, 88, 8) };
        break;
      case 'CloseRequested':
        if (b.length < 72 + 16) return null;
        ev.extra = { closeRequestedAt: readUintLE(b, 72, 8), challengeEndsAt: readUintLE(b, 80, 8) };
        break;
      case 'StateSubmitted':
        if (b.length < 72 + 16) return null;
        ev.amount = readUintLE(b, 72, 8);
        ev.extra = { nonce: readUintLE(b, 80, 8) };
        break;
      case 'Finalized':
        if (b.length < 72 + 32 + 16 + 1) return null;
        ev.amount = readUintLE(b, 72, 8);
        ev.extra = {
          totalDeposits: readUintLE(b, 80, 8),
          bond: readUintLE(b, 88, 8),
          available: readUintLE(b, 96, 8),
          finalizedSum: readUintLEString(b, 104, 16),
          cut: b[120] === 1,
        };
        break;
      case 'Withdrawn':
      case 'HostWithdrawn':
        if (b.length < 72 + 8) return null;
        ev.amount = readUintLE(b, 72, 8);
        break;
    }
    return ev;
  }
  return null;
}

/**
 * Every huddle_vault event in a transaction's log messages, in order. Only `Program data:` lines
 * logged while huddle_vault itself is the executing program are considered, so another program in
 * the same transaction cannot forge an event.
 */
export function parseHuddleLogs(logs: readonly string[], programId: string): DecodedHuddleEvent[] {
  const stack: string[] = [];
  const out: DecodedHuddleEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1] as string);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith('Program data: ') && stack[stack.length - 1] === programId) {
      const ev = decodeHuddleEvent(line.slice('Program data: '.length).trim());
      if (ev) out.push(ev);
    }
  }
  return out;
}

export type HuddleChainEventKind = 'create_party' | 'deposit' | 'request_close' | 'submit_state' | 'finalize' | 'withdraw';

/** Event -> the normalized `ChainEvent` fields of @huddle/shared. Null for events with no ChainEvent kind. */
export function toChainEvent(
  ev: DecodedHuddleEvent,
): { kind: HuddleChainEventKind; partyAddress: string; member?: string; amount?: number } | null {
  switch (ev.name) {
    case 'PartyCreated':
      return { kind: 'create_party', partyAddress: ev.party };
    case 'Deposited':
      return { kind: 'deposit', partyAddress: ev.party, member: ev.member, amount: ev.amount };
    case 'CloseRequested':
      return { kind: 'request_close', partyAddress: ev.party };
    case 'StateSubmitted':
      return { kind: 'submit_state', partyAddress: ev.party, member: ev.member, amount: ev.amount };
    case 'Finalized':
      return { kind: 'finalize', partyAddress: ev.party };
    case 'Withdrawn':
      return { kind: 'withdraw', partyAddress: ev.party, member: ev.member, amount: ev.amount };
    case 'HostWithdrawn':
      // The host refund has no ChainEvent kind (the mock does not emit one either).
      return null;
  }
}

/** Instruction -> the normalized `ChainEvent` fields. `withdraw` has no amount here (see INSTRUCTION_LAYOUT). */
export function instructionToChainEvent(
  ix: DecodedHuddleInstruction,
): { kind: HuddleChainEventKind; partyAddress: string; member?: string; amount?: number } | null {
  switch (ix.instruction) {
    case 'create_party':
      return { kind: 'create_party', partyAddress: ix.partyPda };
    case 'deposit':
      return { kind: 'deposit', partyAddress: ix.partyPda, member: ix.member, amount: ix.amount };
    case 'request_close':
      return { kind: 'request_close', partyAddress: ix.partyPda };
    case 'submit_state':
      return { kind: 'submit_state', partyAddress: ix.partyPda, member: ix.member, amount: ix.amount };
    case 'finalize':
      return { kind: 'finalize', partyAddress: ix.partyPda };
    case 'withdraw':
      return { kind: 'withdraw', partyAddress: ix.partyPda, member: ix.member };
    case 'withdraw_host':
      return null;
  }
}
