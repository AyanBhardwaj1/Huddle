/*
 * Huddle QuickNode Streams filter (Solana devnet).
 *
 * Paste this whole file into the Stream's "Filter" editor (JavaScript), or let
 * scripts/quicknode/create-stream.ts upload it. QuickNode calls `main(stream)` once per batch:
 * `stream.data` is an array of blocks (the `getBlock` JSON shape: `transactions[].transaction`
 * + `transactions[].meta`) and `stream.metadata` carries network / dataset / batch range.
 * The filter also accepts the "Programs + Logs" dataset shape (`programInvocations`), so either
 * Solana dataset works.
 *
 * It keeps only SUCCESSFUL transactions that invoke HUDDLE_PROGRAM_ID, decodes each huddle_vault
 * instruction from its Anchor discriminator, and emits one record per instruction:
 *
 *   { signature, slot, blockTime, instruction, accounts, partyPda, member, amount? }
 *
 * which is exactly what the engine's `POST /webhooks/quicknode` expects. A batch with nothing of
 * ours returns null (QuickNode then skips the delivery).
 *
 * Streams filters cannot import anything, so the decoder below is an inlined copy of
 * packages/solana-client/src/decode.ts (discriminators and account positions). Keep them in sync:
 * scripts/quicknode/filter.test.ts checks this file against that module.
 */

// Replaced by create-stream.ts from HUDDLE_PROGRAM_ID; edit by hand when pasting into the dashboard.
var HUDDLE_PROGRAM_ID = 'GRpABdrQhDya9n2zuf19w2idbL3CRSqmWYTJs52taRHu';

// Anchor instruction discriminators: sha256("global:<name>")[0..8].
var HUDDLE_IX = {
  create_party: [251, 84, 246, 151, 106, 204, 201, 22],
  deposit: [242, 35, 198, 137, 82, 225, 242, 182],
  request_close: [82, 168, 167, 86, 14, 15, 199, 180],
  submit_state: [172, 31, 42, 160, 233, 237, 4, 251],
  finalize: [171, 61, 218, 56, 127, 115, 12, 217],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
  withdraw_host: [103, 247, 115, 166, 187, 165, 7, 18],
};

// Where the party PDA / member / amount sit for each instruction (same as INSTRUCTION_LAYOUT).
var HUDDLE_LAYOUT = {
  create_party: { party: 2, member: 1, amountFromData: 76 },
  deposit: { party: 2, member: 1, amountFromData: 8 },
  request_close: { party: 1, member: 0 },
  submit_state: { party: 0, member: -1, memberFromData: 8, amountFromData: 48 },
  finalize: { party: 0, member: -1 },
  withdraw: { party: 1, member: 3 },
  withdraw_host: { party: 1, member: 2 },
};

// Anchor event discriminators (sha256("event:<Name>")[0..8]) used to read amounts the
// instruction data does not carry: the withdraw payout is computed on-chain.
var HUDDLE_EV_WITHDRAWN = [20, 89, 223, 198, 194, 124, 219, 13];
var HUDDLE_EV_HOST_WITHDRAWN = [164, 59, 177, 93, 165, 174, 170, 117];

var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b58decode(s) {
  var zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  var bytes = [];
  for (var i = zeros; i < s.length; i++) {
    var carry = B58.indexOf(s[i]);
    if (carry < 0) return null;
    for (var j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  var out = [];
  for (var z = 0; z < zeros; z++) out.push(0);
  for (var k = bytes.length - 1; k >= 0; k--) out.push(bytes[k]);
  return out;
}

function b58encode(bytes) {
  var zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  var digits = [];
  for (var i = zeros; i < bytes.length; i++) {
    var carry = bytes[i];
    for (var j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  var out = '';
  for (var z = 0; z < zeros; z++) out += '1';
  for (var k = digits.length - 1; k >= 0; k--) out += B58[digits[k]];
  return out;
}

function b64decode(s) {
  var clean = String(s).replace(/=+$/, '');
  var out = [];
  var buf = 0;
  var bits = 0;
  for (var i = 0; i < clean.length; i++) {
    var v = B64.indexOf(clean[i]);
    if (v < 0) return null;
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

function readU64(b, at) {
  var v = 0;
  for (var i = 7; i >= 0; i--) v = v * 256 + b[at + i];
  return v;
}

function hasPrefix(b, p) {
  if (!b || b.length < p.length) return false;
  for (var i = 0; i < p.length; i++) if (b[i] !== p[i]) return false;
  return true;
}

/** Instruction data arrives base58 in the `json` encoding; accept base64 ([data, "base64"]) and byte arrays too. */
function ixBytes(data) {
  if (Array.isArray(data)) {
    if (data.length === 2 && typeof data[0] === 'string' && data[1] === 'base64') return b64decode(data[0]);
    return data;
  }
  if (typeof data === 'string') return b58decode(data);
  return null;
}

function keyOf(k) {
  return typeof k === 'string' ? k : k && typeof k.pubkey === 'string' ? k.pubkey : null;
}

/** Decode one huddle_vault instruction; null when the data is not ours. */
function decodeHuddleIx(data, accounts) {
  var b = ixBytes(data);
  if (!b) return null;
  for (var name in HUDDLE_IX) {
    if (!hasPrefix(b, HUDDLE_IX[name])) continue;
    var layout = HUDDLE_LAYOUT[name];
    var party = accounts[layout.party];
    if (!party) return null;
    var out = { instruction: name, partyPda: party, member: null };
    if (layout.member >= 0 && accounts[layout.member]) out.member = accounts[layout.member];
    if (layout.memberFromData !== undefined && b.length >= layout.memberFromData + 32) {
      out.member = b58encode(b.slice(layout.memberFromData, layout.memberFromData + 32));
    }
    if (layout.amountFromData !== undefined && b.length >= layout.amountFromData + 8) out.amount = readU64(b, layout.amountFromData);
    return out;
  }
  return null;
}

/** Payout amounts from `Withdrawn` / `HostWithdrawn` events logged by huddle_vault itself, in order. */
function withdrawAmounts(logs) {
  var stack = [];
  var out = [];
  for (var i = 0; i < (logs || []).length; i++) {
    var line = logs[i];
    var inv = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (inv) {
      stack.push(inv[1]);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.indexOf('Program data: ') === 0 && stack[stack.length - 1] === HUDDLE_PROGRAM_ID) {
      var b = b64decode(line.slice(14).trim());
      if (b && b.length >= 80 && (hasPrefix(b, HUDDLE_EV_WITHDRAWN) || hasPrefix(b, HUDDLE_EV_HOST_WITHDRAWN))) {
        out.push({ member: b58encode(b.slice(40, 72)), amount: readU64(b, 72) });
      }
    }
  }
  return out;
}

function succeeded(meta) {
  if (!meta) return true;
  if (meta.err !== undefined && meta.err !== null) return false;
  if (meta.status && meta.status.Err !== undefined) return false;
  return true;
}

function record(sig, slot, blockTime, accounts, dec, payouts) {
  var r = {
    signature: sig,
    slot: slot,
    blockTime: blockTime,
    instruction: dec.instruction,
    accounts: accounts,
    partyPda: dec.partyPda,
    member: dec.member,
  };
  if (dec.amount !== undefined) r.amount = dec.amount;
  if ((dec.instruction === 'withdraw' || dec.instruction === 'withdraw_host') && r.amount === undefined) {
    for (var i = 0; i < payouts.length; i++) {
      if (payouts[i].member === dec.member && !payouts[i].used) {
        payouts[i].used = true;
        r.amount = payouts[i].amount;
        break;
      }
    }
  }
  return r;
}

/** One `getBlock`-shaped transaction -> records. */
function fromBlockTx(tx, slot, blockTime, out) {
  if (!tx || !tx.transaction || !succeeded(tx.meta)) return;
  var msg = tx.transaction.message || {};
  var keys = (msg.accountKeys || []).map(keyOf);
  var loaded = tx.meta && tx.meta.loadedAddresses;
  if (loaded) keys = keys.concat(loaded.writable || [], loaded.readonly || []);
  var sig = (tx.transaction.signatures || [])[0];
  var ixs = msg.instructions || [];
  var payouts = null;
  for (var i = 0; i < ixs.length; i++) {
    var ix = ixs[i];
    var programId = ix.programId || (typeof ix.programIdIndex === 'number' ? keys[ix.programIdIndex] : null);
    if (programId !== HUDDLE_PROGRAM_ID) continue;
    var accounts = (ix.accounts || []).map(function (a) {
      return typeof a === 'number' ? keys[a] : keyOf(a);
    });
    var dec = decodeHuddleIx(ix.data, accounts);
    if (!dec) continue;
    if (!payouts) payouts = withdrawAmounts(tx.meta && tx.meta.logMessages);
    out.push(record(sig, slot, blockTime, accounts, dec, payouts));
  }
}

/** One "Programs + Logs" dataset entry -> records. */
function fromProgramsEntry(e, out) {
  if (!e || e.success === false || !succeeded(e.meta)) return;
  var payouts = null;
  var inv = e.programInvocations || [];
  for (var i = 0; i < inv.length; i++) {
    if (inv[i].programId !== HUDDLE_PROGRAM_ID || !inv[i].instruction) continue;
    var accounts = (inv[i].instruction.accounts || []).map(keyOf);
    var dec = decodeHuddleIx(inv[i].instruction.data, accounts);
    if (!dec) continue;
    if (!payouts) payouts = withdrawAmounts(e.logs || e.logMessages);
    out.push(record(e.signature, e.slot, e.blockTime, accounts, dec, payouts));
  }
}

function walk(item, metaSlot, out, depth) {
  if (!item || depth > 3) return;
  if (Array.isArray(item)) {
    for (var i = 0; i < item.length; i++) walk(item[i], metaSlot === null ? null : metaSlot + i, out, depth + 1);
    return;
  }
  if (Array.isArray(item.transactions)) {
    var slot = typeof item.slot === 'number' ? item.slot : typeof item.parentSlot === 'number' ? item.parentSlot + 1 : metaSlot;
    var blockTime = typeof item.blockTime === 'number' ? item.blockTime : null;
    for (var t = 0; t < item.transactions.length; t++) fromBlockTx(item.transactions[t], slot, blockTime, out);
  } else if (item.programInvocations) {
    fromProgramsEntry(item, out);
  }
}

// QuickNode calls main(); nothing in this file does.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function main(stream) {
  var data = stream && stream.data !== undefined ? stream.data : stream;
  var meta = (stream && stream.metadata) || {};
  var first = typeof meta.batch_start_range === 'number' ? meta.batch_start_range : null;
  var out = [];
  walk(data, first, out, 0);
  return out.length ? out : null;
}
