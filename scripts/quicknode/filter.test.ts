import {
  DEFAULT_PROGRAM_ID,
  EVENT_DISCRIMINATORS,
  INSTRUCTION_DISCRIMINATORS,
  INSTRUCTION_LAYOUT,
  base58Encode,
  createPartyIx,
  depositIx,
  ed25519VerifyIx,
  finalizeIx,
  findPartyPda,
  partyIdBytes,
  requestCloseIx,
  submitStateIx,
  withdrawHostIx,
  withdrawIx,
} from '@huddle/solana-client';
import { Keypair, PublicKey } from '@solana/web3.js';
import { FILTER_SOURCE, blockTx, loadFilter, sig } from './harness';
import { describe, expect, it } from 'vitest';

/**
 * Runs scripts/quicknode/filter.js exactly as QuickNode would (a bare script defining `main`, no
 * imports) against synthetic Solana blocks built with the same instruction builders and fixtures as
 * packages/solana-client/src/unit.test.ts.
 */

const programId = new PublicKey(DEFAULT_PROGRAM_ID);
const key = (): PublicKey => Keypair.generate().publicKey;

const u64 = (n: number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const eventLog = (name: keyof typeof EVENT_DISCRIMINATORS, ...parts: Buffer[]): string =>
  `Program data: ${Buffer.concat([Buffer.from(EVENT_DISCRIMINATORS[name]), ...parts]).toString('base64')}`;

describe('QuickNode Streams filter', () => {
  const payer = key();
  const host = key();
  const member = key();
  const mint = key();
  const box = key();
  const [party] = findPartyPda(programId, host, 'ABCD');
  const P = party.toBase58();

  it('keeps the discriminators and account positions in sync with packages/solana-client/src/decode.ts', () => {
    const { ctx } = loadFilter();
    expect(ctx.HUDDLE_IX).toEqual(Object.fromEntries(Object.entries(INSTRUCTION_DISCRIMINATORS).map(([k, v]) => [k, [...v]])));
    expect(JSON.parse(JSON.stringify(ctx.HUDDLE_LAYOUT))).toEqual(JSON.parse(JSON.stringify(INSTRUCTION_LAYOUT)));
    expect(ctx.HUDDLE_EV_WITHDRAWN).toEqual([...EVENT_DISCRIMINATORS.Withdrawn]);
    expect(ctx.HUDDLE_EV_HOST_WITHDRAWN).toEqual([...EVENT_DISCRIMINATORS.HostWithdrawn]);
    expect(FILTER_SOURCE).not.toMatch(/\brequire\s*\(|^\s*import\s|\bBuffer\.|\bprocess\./m);
  });

  it('decodes every huddle_vault instruction in a block and skips everything else', () => {
    const { main } = loadFilter();
    const stateHash = new Uint8Array(32).fill(9);
    const depositSig = sig();
    const withdrawLogs = [
      `Program ${DEFAULT_PROGRAM_ID} invoke [1]`,
      'Program log: Instruction: Withdraw',
      eventLog('Withdrawn', party.toBuffer(), member.toBuffer(), u64(19_444_444)),
      `Program ${DEFAULT_PROGRAM_ID} success`,
    ];
    const block = {
      blockHeight: 1000,
      blockTime: 1_795_000_000,
      blockhash: 'x',
      parentSlot: 362_636_340,
      previousBlockhash: 'y',
      transactions: [
        blockTx([createPartyIx({ programId, payer, host, party, mint, partyId: partyIdBytes('ABCD'), boxSigner: box, challengeSecs: 60, bond: 5_000_000, requireMemberSig: true })]),
        blockTx([depositIx({ programId, payer, member, party, mint, amount: 10_000_000 })], { signature: depositSig }),
        // A failed deposit: dropped.
        blockTx([depositIx({ programId, payer, member, party, mint, amount: 99_000_000 })], { err: { InstructionError: [0, { Custom: 6000 }] } }),
        // Another program only (an Ed25519 verify on its own): dropped.
        blockTx([ed25519VerifyIx([{ publicKey: box.toBytes(), signature: new Uint8Array(64) }], new Uint8Array(127))]),
        blockTx([requestCloseIx({ programId, signer: box, party })]),
        // submit_state comes after its Ed25519 instruction in the same transaction.
        blockTx([
          ed25519VerifyIx([{ publicKey: box.toBytes(), signature: new Uint8Array(64) }], new Uint8Array(127)),
          submitStateIx({ programId, party, member, nonce: 37, balance: 14_200_000, stateHash }),
        ]),
        blockTx([finalizeIx({ programId, party })]),
        blockTx([withdrawIx({ programId, payer, party, wallet: member, mint })], { logs: withdrawLogs }),
        blockTx([withdrawHostIx({ programId, payer, party, host, mint })]),
      ],
    };
    const out = main({ data: [block], metadata: { network: 'solana-devnet', dataset: 'block', batch_start_range: 362_636_341, batch_end_range: 362_636_341 } })!;
    expect(out.map((r) => r.instruction)).toEqual(['create_party', 'deposit', 'request_close', 'submit_state', 'finalize', 'withdraw', 'withdraw_host']);
    for (const r of out) {
      expect(r).toMatchObject({ slot: 362_636_341, blockTime: 1_795_000_000, partyPda: P });
      expect(r.signature.length).toBeGreaterThan(80);
      expect(r.accounts.length).toBeGreaterThan(0);
    }
    expect(out[0]).toMatchObject({ member: host.toBase58(), amount: 5_000_000 });
    expect(out[1]).toEqual({
      signature: depositSig,
      slot: 362_636_341,
      blockTime: 1_795_000_000,
      instruction: 'deposit',
      accounts: depositIx({ programId, payer, member, party, mint, amount: 1 }).keys.map((k) => k.pubkey.toBase58()),
      partyPda: P,
      member: member.toBase58(),
      amount: 10_000_000,
    });
    expect(out[2]).toMatchObject({ member: box.toBase58() });
    expect(out[2]!.amount).toBeUndefined();
    expect(out[3]).toMatchObject({ member: member.toBase58(), amount: 14_200_000 });
    expect(out[4]).toMatchObject({ member: null });
    expect(out[5]).toMatchObject({ member: member.toBase58(), amount: 19_444_444 }); // from the Withdrawn event
    expect(out[6]).toMatchObject({ member: host.toBase58() });
  });

  it('returns null for a batch with nothing of ours, and ignores a different program id', () => {
    const { main } = loadFilter();
    const other = loadFilter(key().toBase58()).main;
    const block = { blockTime: 1, parentSlot: 9, transactions: [blockTx([depositIx({ programId, payer, member, party, mint, amount: 1 })])] };
    expect(main({ data: [], metadata: {} })).toBeNull();
    expect(main({ data: [{ blockTime: 1, parentSlot: 1, transactions: [] }], metadata: {} })).toBeNull();
    expect(other({ data: [block], metadata: {} })).toBeNull();
    expect(main({ data: [block], metadata: {} })).toHaveLength(1);
  });

  it('resolves accounts loaded from an address lookup table (v0 transactions)', () => {
    const { main } = loadFilter();
    const tx = blockTx([depositIx({ programId, payer, member, party, mint, amount: 7 })], { lookup: [party] });
    expect(tx.transaction.message.accountKeys).not.toContain(P);
    const out = main({ data: [{ blockTime: 5, parentSlot: 99, transactions: [tx] }], metadata: {} })!;
    expect(out[0]).toMatchObject({ instruction: 'deposit', partyPda: P, member: member.toBase58(), amount: 7, slot: 100 });
  });

  it('accepts the jsonParsed shape and the "Programs + Logs" dataset shape', () => {
    const { main } = loadFilter();
    const ix = depositIx({ programId, payer, member, party, mint, amount: 3_000_000 });
    const accounts = ix.keys.map((k) => k.pubkey.toBase58());
    const parsed = {
      blockTime: 7,
      slot: 500,
      transactions: [
        {
          meta: { err: null, logMessages: [] },
          transaction: {
            signatures: ['5parsed'],
            message: { accountKeys: accounts.map((pubkey) => ({ pubkey, signer: false, writable: true })), instructions: [{ programId: DEFAULT_PROGRAM_ID, accounts, data: base58Encode(ix.data) }] },
          },
        },
      ],
    };
    expect(main({ data: [parsed], metadata: {} })).toEqual([
      { signature: '5parsed', slot: 500, blockTime: 7, instruction: 'deposit', accounts, partyPda: P, member: member.toBase58(), amount: 3_000_000 },
    ]);
    const programsWithLogs = [
      [
        { signature: '5pl', slot: 600, blockTime: 8, success: true, logs: [], programInvocations: [{ programId: DEFAULT_PROGRAM_ID, instruction: { index: 0, accounts, data: base58Encode(ix.data), tokenBalances: [] } }] },
        { signature: '5failed', slot: 600, blockTime: 8, success: false, logs: [], programInvocations: [{ programId: DEFAULT_PROGRAM_ID, instruction: { index: 0, accounts, data: base58Encode(ix.data) } }] },
      ],
    ];
    expect(main({ data: programsWithLogs, metadata: {} })).toEqual([
      { signature: '5pl', slot: 600, blockTime: 8, instruction: 'deposit', accounts, partyPda: P, member: member.toBase58(), amount: 3_000_000 },
    ]);
  });
});
