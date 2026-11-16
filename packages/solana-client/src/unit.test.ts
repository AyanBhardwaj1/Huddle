import { createHash } from 'node:crypto';
import { BorshAccountsCoder, BorshInstructionCoder, BN, type Idl } from '@coral-xyz/anchor';
import { encodeStateMessage, generateKeyPair, hexEncode, settleClaims, STATE_MESSAGE_LEN } from '@huddle/shared';
import { MockSettlementClient } from '@huddle/shared/mocks';
import { Ed25519Program, Keypair, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import idlJson from './idl/huddle_vault.json';
import {
  DEFAULT_PROGRAM_ID,
  EVENT_DISCRIMINATORS,
  INSTRUCTION_DISCRIMINATORS,
  MEMBER_ACCOUNT_SIZE,
  MEMBER_DISCRIMINATOR,
  PARTY_DISCRIMINATOR,
  VAULT_ERRORS,
  VAULT_ERROR_BASE,
  VaultSettlementClient,
  base58Decode,
  base58Encode,
  base64Decode,
  createPartyIx,
  createSettlementClient,
  decodeHuddleEvent,
  decodeHuddleInstruction,
  decodeMember,
  decodeParty,
  depositIx,
  ed25519VerifyIx,
  finalizeIx,
  findMemberPda,
  findPartyPda,
  findVaultPda,
  instructionToChainEvent,
  memberPayout,
  parseHuddleLogs,
  partyIdBytes,
  requestCloseIx,
  resetSettlementWarning,
  settleFromParty,
  submitStateIx,
  toChainEvent,
  toVaultError,
  withdrawHostIx,
  withdrawIx,
  type HuddleEventName,
  type HuddleInstructionName,
} from './index';

const idl = idlJson as unknown as Idl;
const programId = new PublicKey(DEFAULT_PROGRAM_ID);
const sha8 = (s: string) => [...createHash('sha256').update(s).digest().subarray(0, 8)];
const key = () => Keypair.generate().publicKey;

interface IdlIx {
  name: string;
  discriminator: number[];
  accounts: { name: string; writable?: boolean; signer?: boolean; optional?: boolean }[];
}
const idlIx = (name: string): IdlIx => {
  const ix = (idlJson.instructions as IdlIx[]).find((i) => i.name === name);
  if (!ix) throw new Error(`no ${name} in the IDL`);
  return ix;
};

describe('discriminators', () => {
  it('instruction discriminators are sha256("global:<name>")[0..8] and match the IDL', () => {
    const names = Object.keys(INSTRUCTION_DISCRIMINATORS) as HuddleInstructionName[];
    expect(names.sort()).toEqual((idlJson.instructions as IdlIx[]).map((i) => i.name).sort());
    for (const name of names) {
      expect([...INSTRUCTION_DISCRIMINATORS[name]]).toEqual(sha8(`global:${name}`));
      expect([...INSTRUCTION_DISCRIMINATORS[name]]).toEqual(idlIx(name).discriminator);
    }
  });

  it('event discriminators are sha256("event:<Name>")[0..8] and match the IDL', () => {
    const names = Object.keys(EVENT_DISCRIMINATORS) as HuddleEventName[];
    const idlEvents = idlJson.events as { name: string; discriminator: number[] }[];
    expect(names.sort()).toEqual(idlEvents.map((e) => e.name).sort());
    for (const name of names) {
      expect([...EVENT_DISCRIMINATORS[name]]).toEqual(sha8(`event:${name}`));
      expect([...EVENT_DISCRIMINATORS[name]]).toEqual(idlEvents.find((e) => e.name === name)?.discriminator);
    }
  });

  it('account discriminators and the error table match the IDL', () => {
    expect([...PARTY_DISCRIMINATOR]).toEqual(sha8('account:Party'));
    expect([...MEMBER_DISCRIMINATOR]).toEqual(sha8('account:Member'));
    const errors = idlJson.errors as { code: number; name: string }[];
    expect(errors.map((e) => e.name)).toEqual([...VAULT_ERRORS]);
    expect(errors[0]?.code).toBe(VAULT_ERROR_BASE);
    expect(idlJson.address).toBe(DEFAULT_PROGRAM_ID);
  });
});

describe('PDA derivation', () => {
  it('party id: short ids are zero-padded UTF-8, long ids are hashed', () => {
    const short = partyIdBytes('ABCD');
    expect(short.length).toBe(32);
    expect([...short.subarray(0, 4)]).toEqual([65, 66, 67, 68]);
    expect(short.subarray(4).every((b) => b === 0)).toBe(true);
    const long = 'x'.repeat(33);
    expect([...partyIdBytes(long)]).toEqual([...createHash('sha256').update(long).digest()]);
    expect(partyIdBytes('y'.repeat(32)).every((b) => b === 121)).toBe(true);
    expect(() => partyIdBytes('')).toThrow();
  });

  it('derives party, member and vault addresses from the documented seeds', () => {
    const host = key();
    const wallet = key();
    const [party, bump] = findPartyPda(programId, host, 'ABCD');
    expect(party.equals(PublicKey.findProgramAddressSync([Buffer.from('party'), host.toBuffer(), Buffer.from(partyIdBytes('ABCD'))], programId)[0])).toBe(true);
    expect(PublicKey.createProgramAddressSync([Buffer.from('party'), host.toBuffer(), Buffer.from(partyIdBytes('ABCD')), Buffer.from([bump])], programId).equals(party)).toBe(true);
    expect(findMemberPda(programId, party, wallet)[0].equals(PublicKey.findProgramAddressSync([Buffer.from('member'), party.toBuffer(), wallet.toBuffer()], programId)[0])).toBe(true);
    expect(findVaultPda(programId, party)[0].equals(PublicKey.findProgramAddressSync([Buffer.from('vault'), party.toBuffer()], programId)[0])).toBe(true);
    // A different host or id gives a different party.
    expect(findPartyPda(programId, key(), 'ABCD')[0].equals(party)).toBe(false);
    expect(findPartyPda(programId, host, 'ABCE')[0].equals(party)).toBe(false);
  });
});

describe('instruction builders', () => {
  const payer = key();
  const host = key();
  const member = key();
  const mint = key();
  const box = key();
  const [party] = findPartyPda(programId, host, 'ABCD');
  const stateHash = new Uint8Array(32).fill(9);

  const built = {
    create_party: createPartyIx({ programId, payer, host, party, mint, partyId: partyIdBytes('ABCD'), boxSigner: box, challengeSecs: 60, bond: 5_000_000, requireMemberSig: true }),
    deposit: depositIx({ programId, payer, member, party, mint, amount: 10_000_000 }),
    request_close: requestCloseIx({ programId, signer: box, party }),
    submit_state: submitStateIx({ programId, party, member, nonce: 37, balance: 14_200_000, stateHash }),
    finalize: finalizeIx({ programId, party }),
    withdraw: withdrawIx({ programId, payer, party, wallet: member, mint }),
    withdraw_host: withdrawHostIx({ programId, payer, party, host, mint }),
  };

  it('account lists match the IDL (count, signer and writable flags)', () => {
    for (const [name, ix] of Object.entries(built)) {
      const spec = idlIx(name).accounts;
      expect(ix.keys.length, name).toBe(spec.length);
      spec.forEach((a, i) => {
        expect(ix.keys[i]?.isSigner, `${name}.${a.name} signer`).toBe(!!a.signer);
        expect(ix.keys[i]?.isWritable, `${name}.${a.name} writable`).toBe(!!a.writable);
      });
    }
    expect(built.submit_state.keys[2]?.pubkey.equals(SYSVAR_INSTRUCTIONS_PUBKEY)).toBe(true);
    // A missing optional account is encoded as the program id.
    expect(built.request_close.keys[2]?.pubkey.equals(programId)).toBe(true);
    expect(requestCloseIx({ programId, signer: member, party, asMember: true }).keys[2]?.pubkey.equals(findMemberPda(programId, party, member)[0])).toBe(true);
  });

  it('instruction data equals what Anchor encodes from the IDL', () => {
    const coder = new BorshInstructionCoder(idl);
    const cases: [HuddleInstructionName, Record<string, unknown>][] = [
      ['create_party', { party_id: [...partyIdBytes('ABCD')], box_signer: box, challenge_secs: 60, bond: new BN(5_000_000), require_member_sig: true }],
      ['deposit', { amount: new BN(10_000_000) }],
      ['request_close', {}],
      ['submit_state', { member, nonce: new BN(37), balance: new BN(14_200_000), state_hash: [...stateHash] }],
      ['finalize', {}],
      ['withdraw', {}],
      ['withdraw_host', {}],
    ];
    for (const [name, args] of cases) {
      expect([...built[name].data], name).toEqual([...coder.encode(name, args)]);
    }
  });

  it('decodeHuddleInstruction recovers name, party, member and amount', () => {
    const decode = (name: HuddleInstructionName) => decodeHuddleInstruction(built[name].data, built[name].keys.map((k) => k.pubkey.toBase58()));
    expect(decode('create_party')).toEqual({ instruction: 'create_party', partyPda: party.toBase58(), member: host.toBase58(), amount: 5_000_000 });
    expect(decode('deposit')).toEqual({ instruction: 'deposit', partyPda: party.toBase58(), member: member.toBase58(), amount: 10_000_000 });
    expect(decode('request_close')).toEqual({ instruction: 'request_close', partyPda: party.toBase58(), member: box.toBase58() });
    expect(decode('submit_state')).toEqual({ instruction: 'submit_state', partyPda: party.toBase58(), member: member.toBase58(), amount: 14_200_000, nonce: 37 });
    expect(decode('finalize')).toEqual({ instruction: 'finalize', partyPda: party.toBase58() });
    expect(decode('withdraw')).toEqual({ instruction: 'withdraw', partyPda: party.toBase58(), member: member.toBase58() });
    expect(decode('withdraw_host')).toEqual({ instruction: 'withdraw_host', partyPda: party.toBase58(), member: host.toBase58() });

    // JSON-RPC gives the data as base58.
    expect(decodeHuddleInstruction(base58Encode(built.deposit.data), built.deposit.keys.map((k) => k.pubkey.toBase58()))?.amount).toBe(10_000_000);
    expect(decodeHuddleInstruction(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), [party.toBase58()])).toBeNull();
    expect(decodeHuddleInstruction('not base58 0OIl', [])).toBeNull();
    expect(instructionToChainEvent(decode('deposit')!)).toEqual({ kind: 'deposit', partyAddress: party.toBase58(), member: member.toBase58(), amount: 10_000_000 });
    expect(instructionToChainEvent(decode('withdraw_host')!)).toBeNull();
  });
});

describe('signed state message and Ed25519 instruction', () => {
  it('the Ed25519 instruction carries exactly encodeStateMessage and self-contained offsets', () => {
    const box = generateKeyPair();
    const member = generateKeyPair();
    const party = key().toBase58();
    const fields = { party, member: member.publicKey, nonce: 37, balance: 14_200_000, stateHash: hexEncode(new Uint8Array(32).fill(3)) };
    const message = encodeStateMessage(fields);
    expect(message.length).toBe(STATE_MESSAGE_LEN);
    expect(STATE_MESSAGE_LEN).toBe(127);

    const signers = [box, member].map((k) => ({ publicKey: base58Decode(k.publicKey), signature: nacl.sign.detached(message, k.secretKey) }));
    const ix = ed25519VerifyIx(signers, message);
    expect(ix.programId.equals(Ed25519Program.programId)).toBe(true);
    expect(ix.keys.length).toBe(0);
    const d = ix.data;
    expect(d[0]).toBe(2);
    for (let i = 0; i < 2; i++) {
      const o = 2 + i * 14;
      const sigOff = d.readUInt16LE(o);
      const pkOff = d.readUInt16LE(o + 4);
      const msgOff = d.readUInt16LE(o + 8);
      const msgLen = d.readUInt16LE(o + 10);
      // Every instruction index means "this instruction".
      expect([d.readUInt16LE(o + 2), d.readUInt16LE(o + 6), d.readUInt16LE(o + 12)]).toEqual([0xffff, 0xffff, 0xffff]);
      expect(msgLen).toBe(127);
      const msg = d.subarray(msgOff, msgOff + msgLen);
      expect([...msg]).toEqual([...message]);
      expect(nacl.sign.detached.verify(msg, d.subarray(sigOff, sigOff + 64), d.subarray(pkOff, pkOff + 32))).toBe(true);
      expect(base58Encode(d.subarray(pkOff, pkOff + 32))).toBe([box, member][i]?.publicKey);
    }
    expect(d.length).toBe(2 + 2 * 14 + 2 * 96 + 127);
  });

  it('the submit_state arguments are the same fields the message commits to', () => {
    const party = key();
    const member = key();
    const stateHash = new Uint8Array(32).fill(5);
    const ix = submitStateIx({ programId, party, member, nonce: 12, balance: 999, stateHash });
    const message = encodeStateMessage({ party: party.toBase58(), member: member.toBase58(), nonce: 12, balance: 999, stateHash: hexEncode(stateHash) });
    // message = domain(15) | party | member | nonce | balance | hash ; data = disc(8) | member | nonce | balance | hash
    expect([...ix.data.subarray(8)]).toEqual([...message.subarray(47)]);
    expect(new TextDecoder().decode(message.subarray(0, 15))).toBe('HUDDLE_STATE_V1');
    expect([...message.subarray(15, 47)]).toEqual([...party.toBytes()]);
  });
});

describe('account decoding', () => {
  const accounts = new BorshAccountsCoder(idl);

  it('decodes a Party account encoded by Anchor from the IDL', async () => {
    const host = key();
    const boxSigner = key();
    const mint = key();
    const vault = key();
    const data = await accounts.encode('Party', {
      host,
      party_id: [...partyIdBytes('ABCD')],
      box_signer: boxSigner,
      mint,
      vault,
      status: { Closing: {} },
      require_member_sig: true,
      bump: 254,
      vault_bump: 253,
      member_count: 3,
      claims_count: 2,
      withdrawn_count: 1,
      challenge_secs: 60,
      created_at: new BN(1_700_000_000),
      close_requested_at: new BN(1_700_000_100),
      finalized_at: new BN(0),
      total_deposits: new BN(30_000_000),
      bond: new BN(5_000_000),
      claimed_deposits: new BN(20_000_000),
      sum_claims: new BN('340282366920938463463374607431768211455'),
      finalized_sum: new BN(45_000_001),
      available: new BN(35_000_000),
      cut: true,
      host_refund: new BN(7),
      host_refund_paid: false,
      total_paid: new BN(11),
    });
    const p = decodeParty(data);
    expect(p.host.equals(host)).toBe(true);
    expect(p.boxSigner.equals(boxSigner)).toBe(true);
    expect(p.mint.equals(mint)).toBe(true);
    expect(p.vault.equals(vault)).toBe(true);
    expect([...p.partyId]).toEqual([...partyIdBytes('ABCD')]);
    expect(p).toMatchObject({
      status: 'closing',
      requireMemberSig: true,
      bump: 254,
      vaultBump: 253,
      memberCount: 3,
      claimsCount: 2,
      withdrawnCount: 1,
      challengeSecs: 60,
      createdAt: 1_700_000_000,
      closeRequestedAt: 1_700_000_100,
      finalizedAt: 0,
      totalDeposits: 30_000_000n,
      bond: 5_000_000n,
      claimedDeposits: 20_000_000n,
      sumClaims: (1n << 128n) - 1n,
      finalizedSum: 45_000_001n,
      available: 35_000_000n,
      cut: true,
      hostRefund: 7n,
      hostRefundPaid: false,
      totalPaid: 11n,
    });
  });

  it('decodes a Member account encoded by Anchor from the IDL', async () => {
    const party = key();
    const wallet = key();
    const data = await accounts.encode('Member', {
      party,
      wallet,
      deposited: new BN(10_000_000),
      claim_balance: new BN(14_200_000),
      claim_nonce: new BN(37),
      claim_state_hash: new Array(32).fill(4),
      has_claim: true,
      withdrawn: false,
      paid_out: new BN(0),
      bump: 251,
    });
    expect(data.length).toBe(MEMBER_ACCOUNT_SIZE);
    const m = decodeMember(data);
    expect(m.party.equals(party)).toBe(true);
    expect(m.wallet.equals(wallet)).toBe(true);
    expect(m).toMatchObject({ deposited: 10_000_000n, claimBalance: 14_200_000n, claimNonce: 37n, hasClaim: true, withdrawn: false, paidOut: 0n, bump: 251 });
    expect(() => decodeParty(data)).toThrow('not a Party account');
  });
});

describe('finalize math mirrors settleClaims', () => {
  it('matches the shared reference on random parties', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 500; round++) {
      const n = rnd(6);
      const deposits: Record<string, number> = {};
      const claims: Record<string, number | undefined> = {};
      let total = 0n;
      let claimed = 0n;
      let sumClaims = 0n;
      const members: { hasClaim: boolean; claimBalance: bigint; deposited: bigint; id: string }[] = [];
      for (let i = 0; i < n; i++) {
        const id = `m${i}`;
        const dep = 1 + rnd(50_000_000);
        deposits[id] = dep;
        total += BigInt(dep);
        const hasClaim = rnd(3) !== 0;
        const claim = hasClaim ? rnd(3) === 0 ? rnd(200_000_000) : rnd(2 * dep) : 0;
        if (hasClaim) {
          claims[id] = claim;
          claimed += BigInt(dep);
          sumClaims += BigInt(claim);
        }
        members.push({ hasClaim, claimBalance: BigInt(claim), deposited: BigInt(dep), id });
      }
      const bond = rnd(3) === 0 ? 0 : rnd(10_000_000);
      const ref = settleClaims({ deposits, claims, bond });
      const s = settleFromParty({ totalDeposits: total, bond: BigInt(bond), sumClaims, claimedDeposits: claimed });
      expect(s.cut).toBe(ref.cut);
      let paid = 0n;
      for (const m of members) {
        const p = memberPayout(m, s);
        expect(Number(p)).toBe(ref.payouts[m.id]);
        paid += p;
      }
      // Host: refund at finalize + what is left in the vault after every member withdrew.
      expect(Number(s.available - paid)).toBe(ref.hostRefund);
      if (!s.cut) expect(Number(s.hostRefund)).toBe(ref.hostRefund);
      else expect(s.hostRefund).toBe(0n);
    }
  });
});

describe('event decoding', () => {
  const party = key();
  const who = key();
  const u64 = (n: number | bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const event = (name: HuddleEventName, ...rest: Buffer[]) =>
    Buffer.concat([Buffer.from(EVENT_DISCRIMINATORS[name]), party.toBuffer(), who.toBuffer(), ...rest]).toString('base64');

  it('decodes every event and maps it to a ChainEvent', () => {
    const deposited = decodeHuddleEvent(event('Deposited', u64(10_000_000), u64(15_000_000), u64(40_000_000)));
    expect(deposited).toEqual({ name: 'Deposited', party: party.toBase58(), member: who.toBase58(), amount: 10_000_000, extra: { memberDeposited: 15_000_000, totalDeposits: 40_000_000 } });
    expect(toChainEvent(deposited!)).toEqual({ kind: 'deposit', partyAddress: party.toBase58(), member: who.toBase58(), amount: 10_000_000 });

    const submitted = decodeHuddleEvent(event('StateSubmitted', u64(14_200_000), u64(37), Buffer.alloc(32, 1)));
    expect(submitted?.amount).toBe(14_200_000);
    expect(submitted?.extra.nonce).toBe(37);
    expect(toChainEvent(submitted!)?.kind).toBe('submit_state');

    const closed = decodeHuddleEvent(event('CloseRequested', u64(1_700_000_000), u64(1_700_000_060)));
    expect(closed?.extra).toEqual({ closeRequestedAt: 1_700_000_000, challengeEndsAt: 1_700_000_060 });
    expect(toChainEvent(closed!)).toEqual({ kind: 'request_close', partyAddress: party.toBase58() });

    const u128 = Buffer.concat([u64(45_000_001), u64(0)]);
    const finalized = decodeHuddleEvent(event('Finalized', u64(0), u64(30_000_000), u64(5_000_000), u64(35_000_000), u128, Buffer.from([1])));
    expect(finalized?.extra).toEqual({ totalDeposits: 30_000_000, bond: 5_000_000, available: 35_000_000, finalizedSum: '45000001', cut: true });
    expect(toChainEvent(finalized!)).toEqual({ kind: 'finalize', partyAddress: party.toBase58() });

    const withdrawn = decodeHuddleEvent(event('Withdrawn', u64(19_444_444)));
    expect(toChainEvent(withdrawn!)).toEqual({ kind: 'withdraw', partyAddress: party.toBase58(), member: who.toBase58(), amount: 19_444_444 });
    expect(toChainEvent(decodeHuddleEvent(event('HostWithdrawn', u64(7)))!)).toBeNull();

    const u32 = Buffer.alloc(4);
    u32.writeUInt32LE(60);
    const created = decodeHuddleEvent(event('PartyCreated', key().toBuffer(), key().toBuffer(), key().toBuffer(), Buffer.alloc(32, 2), u64(5_000_000), u32, Buffer.from([1])));
    expect(created?.amount).toBe(5_000_000);
    expect(created?.extra.challengeSecs).toBe(60);
    expect(created?.extra.requireMemberSig).toBe(true);
    expect(toChainEvent(created!)).toEqual({ kind: 'create_party', partyAddress: party.toBase58() });

    expect(decodeHuddleEvent('AAAAAAAAAAAAAAAA')).toBeNull();
    expect(decodeHuddleEvent(event('Withdrawn'))).toBeNull(); // truncated
  });

  it('parseHuddleLogs only trusts data logged while huddle_vault is executing', () => {
    const other = key().toBase58();
    const real = event('Deposited', u64(1), u64(1), u64(1));
    const forged = event('Withdrawn', u64(999));
    const logs = [
      `Program ${other} invoke [1]`,
      `Program data: ${forged}`,
      `Program ${other} success`,
      `Program ${DEFAULT_PROGRAM_ID} invoke [1]`,
      'Program log: Instruction: Deposit',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
      `Program data: ${forged}`,
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 6000 of 180000 compute units',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
      `Program data: ${real}`,
      `Program ${DEFAULT_PROGRAM_ID} consumed 30000 of 200000 compute units`,
      `Program ${DEFAULT_PROGRAM_ID} success`,
    ];
    const events = parseHuddleLogs(logs, DEFAULT_PROGRAM_ID);
    expect(events.map((e) => e.name)).toEqual(['Deposited']);
  });

  it('base58 / base64 helpers round-trip', () => {
    for (let i = 0; i < 50; i++) {
      const k = key();
      expect(base58Encode(k.toBytes())).toBe(k.toBase58());
      expect([...base58Decode(k.toBase58())]).toEqual([...k.toBytes()]);
    }
    expect(base58Encode(new Uint8Array(32))).toBe(PublicKey.default.toBase58());
    const bytes = Uint8Array.from({ length: 77 }, (_, i) => (i * 37) & 0xff);
    for (const len of [0, 1, 2, 3, 76, 77]) {
      expect([...base64Decode(Buffer.from(bytes.subarray(0, len)).toString('base64'))]).toEqual([...bytes.subarray(0, len)]);
    }
  });
});

describe('error mapping', () => {
  it('maps program error codes to the same messages the mock uses', () => {
    expect(toVaultError({ InstructionError: [1, { Custom: 6011 }] }).message).toBe('stale nonce');
    expect(toVaultError({ InstructionError: [0, { Custom: 6003 }] }).code).toBe('ChallengeWindowOpen');
    const preflight = Object.assign(new Error('Simulation failed'), { logs: ['Program x failed: custom program error: 0x177c'] });
    expect(toVaultError(preflight).code).toBe('AlreadyWithdrawn');
    expect(toVaultError(new Error('failed: custom program error: 0x1')).message).toBe('insufficient USDC balance');
    expect(toVaultError(new Error('boom')).code).toBeUndefined();
  });
});

describe('createSettlementClient', () => {
  const treasury = Keypair.generate();
  const full = {
    SOLANA_RPC_URL: 'http://127.0.0.1:8899',
    HUDDLE_PROGRAM_ID: DEFAULT_PROGRAM_ID,
    USDC_MINT: key().toBase58(),
    TREASURY_SECRET_KEY: JSON.stringify([...treasury.secretKey]),
    SOLANA_CLUSTER: 'localnet',
  };
  afterEach(() => {
    vi.restoreAllMocks();
    resetSettlementWarning();
  });

  it('points mode is always the mock, with no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = createSettlementClient('points', full);
    expect(c).toBeInstanceOf(MockSettlementClient);
    expect(c.mode).toBe('points');
    expect(warn).not.toHaveBeenCalled();
  });

  it('vault / trusted without the env fall back to the mock with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = createSettlementClient('vault', {});
    const b = createSettlementClient('trusted', { ...full, USDC_MINT: '' });
    expect(a).toBeInstanceOf(MockSettlementClient);
    expect(a.mode).toBe('vault');
    expect(b).toBeInstanceOf(MockSettlementClient);
    expect(b.mode).toBe('trusted');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('SOLANA_RPC_URL');
  });

  it('returns the real client when everything is set', () => {
    const c = createSettlementClient('vault', full);
    expect(c).toBeInstanceOf(VaultSettlementClient);
    expect(c.mode).toBe('vault');
    expect(c.label).toContain('localnet');
    expect((c as VaultSettlementClient).treasuryAddress).toBe(treasury.publicKey.toBase58());
    expect(c.explorerUrl('abc')).toContain('explorer.solana.com/tx/abc');
    expect(createSettlementClient('trusted', { ...full, SOLANA_CLUSTER: undefined }).explorerUrl('abc')).toBe('https://explorer.solana.com/tx/abc?cluster=devnet');
  });

  it('never leaks the secret key and refuses mainnet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = createSettlementClient('vault', { ...full, TREASURY_SECRET_KEY: '[1,2,3,"oops-secret"' });
    expect(bad).toBeInstanceOf(MockSettlementClient);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('oops-secret');
    resetSettlementWarning();
    const mainnet = createSettlementClient('vault', { ...full, SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' });
    expect(mainnet).toBeInstanceOf(MockSettlementClient);
    expect(String(warn.mock.calls[1]?.[0])).toContain('devnet only');
  });
});
