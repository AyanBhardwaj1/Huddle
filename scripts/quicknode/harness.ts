/** Test helpers: load filter.js like QuickNode does, and build `getBlock`-shaped transactions. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROGRAM_ID, base58Encode } from '@huddle/solana-client';
import { Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FILTER_SOURCE = fs.readFileSync(path.join(here, 'filter.js'), 'utf8');

export interface FilterRecord {
  signature: string;
  slot: number | null;
  blockTime: number | null;
  instruction: string;
  accounts: string[];
  partyPda: string;
  member: string | null;
  amount?: number;
}

/** Load the filter in a fresh sandbox (no require, no process, no Buffer) and return its globals. */
export function loadFilter(programId = DEFAULT_PROGRAM_ID): { main: (stream: unknown) => FilterRecord[] | null; ctx: Record<string, unknown> } {
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(FILTER_SOURCE.replace(/var HUDDLE_PROGRAM_ID = '[^']*'/, `var HUDDLE_PROGRAM_ID = '${programId}'`), ctx);
  return { main: ctx.main as (stream: unknown) => FilterRecord[] | null, ctx };
}

export const sig = (): string => base58Encode(Keypair.generate().secretKey); // 64 random bytes, like a signature

/** Compile instructions into a `getBlock` (encoding "json") transaction: accountKeys + index-based instructions. */
export function blockTx(ixs: TransactionInstruction[], opts: { err?: unknown; logs?: string[]; signature?: string; lookup?: PublicKey[] } = {}) {
  const keys: string[] = [];
  const lookup = new Set((opts.lookup ?? []).map((k) => k.toBase58()));
  const indexOf = (k: PublicKey): number => {
    const s = k.toBase58();
    if (lookup.has(s)) return -1;
    let i = keys.indexOf(s);
    if (i < 0) i = keys.push(s) - 1;
    return i;
  };
  ixs.forEach((ix) => {
    indexOf(ix.programId);
    ix.keys.forEach((k) => indexOf(k.pubkey));
  });
  const loaded = [...lookup];
  const idx = (k: PublicKey): number => {
    const i = indexOf(k);
    return i >= 0 ? i : keys.length + loaded.indexOf(k.toBase58());
  };
  return {
    meta: {
      err: opts.err ?? null,
      status: opts.err ? { Err: opts.err } : { Ok: null },
      logMessages: opts.logs ?? [],
      ...(loaded.length ? { loadedAddresses: { writable: loaded, readonly: [] } } : {}),
    },
    transaction: {
      signatures: [opts.signature ?? sig()],
      message: {
        accountKeys: keys,
        instructions: ixs.map((ix) => ({
          programIdIndex: idx(ix.programId),
          accounts: ix.keys.map((k) => idx(k.pubkey)),
          data: base58Encode(ix.data),
          stackHeight: null,
        })),
      },
    },
  };
}

