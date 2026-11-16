import {
  b64decode,
  b64encode,
  generateKeyPair,
  hexEncode,
  signState,
  type ChainEvent,
  type KeyPair,
  type SettlementClient,
  type SignedClaim,
} from '@huddle/shared';
import { MockSettlementClient } from '@huddle/shared/mocks';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { beforeAll, describe, expect, it } from 'vitest';
import { VaultSettlementClient, createSettlementClient } from '../../src';
import { HAS_VALIDATOR, PROGRAM_ID, RPC_URL, USDC, setup, sleep, type Ctx } from '../helpers';

/**
 * The full party flow through the `SettlementClient` interface, against a local validator:
 * create -> faucet -> deposits -> close -> submit states -> finalize -> withdraw.
 * The same scenario runs against `MockSettlementClient` and the results must be identical.
 *
 * Runs under `sh scripts/solana-test.sh` (or with HUDDLE_LOCALNET_URL set); skipped otherwise.
 */

const HASH = hexEncode(new Uint8Array(32).fill(1));

function claim(party: string, box: KeyPair, member: KeyPair, nonce: number, balance: number, withMemberSig = true): SignedClaim {
  const fields = { party, member: member.publicKey, nonce, balance, stateHash: HASH };
  return {
    member: member.publicKey,
    nonce,
    balance,
    stateHash: HASH,
    boxSig: signState(fields, box.secretKey),
    memberSig: withMemberSig ? signState(fields, member.secretKey) : undefined,
  };
}

/** Buy in the way the phone does: sign the message bytes with tweetnacl (points mode has nothing to sign). */
async function buyIn(client: SettlementClient, party: string, member: KeyPair, amount: number) {
  const req = await client.prepareDeposit({ partyAddress: party, member: member.publicKey, amount });
  const memberSignatureB64 = req.messageB64 ? b64encode(nacl.sign.detached(b64decode(req.messageB64), member.secretKey)) : undefined;
  return client.submitDeposit({ depositId: req.depositId, memberSignatureB64 });
}

async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return 'NO ERROR';
}

interface ScenarioResult {
  /** Not compared between the chain and the mock (the mock invents an address). */
  partyAddress: string;
  payouts: number[];
  hostPayout: number;
  hostRefund: number;
  withdrawn: number[];
  errors: Record<string, string>;
}

/**
 * One party, three players + the house (host key). `claims[i]` undefined = that player's state is
 * never submitted (defaults to the deposit).
 */
async function scenario(
  client: SettlementClient,
  opts: { requireMemberSig: boolean; bond: number; claims: (number | undefined)[]; houseClaim?: number; challengeSecs: number },
): Promise<ScenarioResult> {
  const host = generateKeyPair();
  const box = generateKeyPair();
  const players = [generateKeyPair(), generateKeyPair(), generateKeyPair()];
  const errors: Record<string, string> = {};

  const { partyAddress } = await client.createParty({
    partyId: `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    hostSecretKey: host.secretKey,
    boxSigner: box.publicKey,
    bond: opts.bond,
    challengeSecs: opts.challengeSecs,
    requireMemberSig: opts.requireMemberSig,
  });

  for (const p of players) {
    await client.faucet(p.publicKey, 25 * USDC);
    expect(await client.walletBalance(p.publicKey)).toBe(25 * USDC);
    const res = await buyIn(client, partyAddress, p, 10 * USDC);
    expect(res.amount).toBe(10 * USDC);
  }
  await client.depositFromKey({ partyAddress, secretKey: host.secretKey, amount: 20 * USDC });

  errors.submitWhileOpen = await errorOf(client.submitState(partyAddress, claim(partyAddress, box, players[0]!, 1, USDC)));
  errors.finalizeWhileOpen = await errorOf(client.finalize(partyAddress));
  errors.closeByStranger = await errorOf(client.requestClose(partyAddress, generateKeyPair().secretKey));

  const closed = await client.requestClose(partyAddress, box.secretKey);
  // The deadline is on our clock: about `challengeSecs` from now, whatever the cluster clock says.
  expect(Math.abs(Date.parse(closed.challengeEndsAt) - (Date.now() + opts.challengeSecs * 1000))).toBeLessThan(5000);
  errors.depositWhileClosing = await errorOf(client.prepareDeposit({ partyAddress, member: players[0]!.publicKey, amount: USDC }));

  // Bad claims first: none of them may change the outcome.
  const stranger = generateKeyPair();
  errors.notAMember = await errorOf(client.submitState(partyAddress, claim(partyAddress, box, stranger, 1, 99 * USDC)));
  errors.badBoxSig = await errorOf(client.submitState(partyAddress, claim(partyAddress, stranger, players[0]!, 5, 99 * USDC)));
  if (opts.requireMemberSig) {
    errors.noMemberSig = await errorOf(client.submitState(partyAddress, claim(partyAddress, box, players[0]!, 5, 99 * USDC, false)));
  }

  for (let i = 0; i < players.length; i++) {
    const balance = opts.claims[i];
    if (balance === undefined) continue;
    // An older state first, then the latest one: the higher nonce must win.
    await client.submitState(partyAddress, claim(partyAddress, box, players[i]!, 3, 10 * USDC, opts.requireMemberSig));
    await client.submitState(partyAddress, claim(partyAddress, box, players[i]!, 7, balance, opts.requireMemberSig));
    errors[`stale${i}`] = await errorOf(client.submitState(partyAddress, claim(partyAddress, box, players[i]!, 6, 99 * USDC, opts.requireMemberSig)));
  }
  if (opts.houseClaim !== undefined) {
    await client.submitState(partyAddress, claim(partyAddress, box, host, 2, opts.houseClaim, opts.requireMemberSig));
  }

  errors.withdrawBeforeFinalize = await errorOf(client.withdraw(partyAddress, players[0]!.publicKey));
  await sleep(opts.challengeSecs * 1000 + 500);
  const fin = await client.finalize(partyAddress);

  const withdrawn: number[] = [];
  for (const p of players) {
    // The payout really arrives in the member's wallet (the mock keeps a simple wallet ledger too).
    const before = await client.walletBalance(p.publicKey);
    const res = await client.withdraw(partyAddress, p.publicKey);
    expect((await client.walletBalance(p.publicKey)) - before).toBe(res.amount);
    expect(fin.payouts[p.publicKey]).toBe(res.amount);
    withdrawn.push(res.amount);
  }
  const hostWithdraw = await client.withdraw(partyAddress, host.publicKey);
  errors.doubleWithdraw = await errorOf(client.withdraw(partyAddress, players[0]!.publicKey));
  expect(fin.payouts[host.publicKey]).toBe(hostWithdraw.amount);
  // Finalizing again is harmless and reports the same result.
  const again = await client.finalize(partyAddress);
  expect(again.payouts).toEqual(fin.payouts);
  expect(again.hostRefund).toBe(fin.hostRefund);

  return {
    partyAddress,
    payouts: players.map((p) => fin.payouts[p.publicKey]!),
    hostPayout: hostWithdraw.amount,
    hostRefund: fin.hostRefund,
    withdrawn,
    errors,
  };
}

describe.skipIf(!HAS_VALIDATOR)('VaultSettlementClient against a local validator', () => {
  let ctx: Ctx;
  let env: Record<string, string>;

  beforeAll(async () => {
    ctx = await setup();
    env = {
      SOLANA_RPC_URL: RPC_URL,
      SOLANA_CLUSTER: 'localnet',
      HUDDLE_PROGRAM_ID: PROGRAM_ID.toBase58(),
      USDC_MINT: ctx.mint.toBase58(),
      TREASURY_SECRET_KEY: JSON.stringify([...ctx.payer.secretKey]),
    };
  }, 60_000);

  const cases = [
    { name: 'vault mode, claims fit: bond and surplus go back to the host', mode: 'vault' as const, requireMemberSig: true, bond: 5 * USDC, claims: [14 * USDC, 4 * USDC, undefined], houseClaim: 21 * USDC },
    { name: 'vault mode, bond covers the shortfall', mode: 'vault' as const, requireMemberSig: true, bond: 5 * USDC, claims: [13 * USDC, undefined, undefined], houseClaim: undefined },
    { name: 'trusted mode, pro-rata cut when the bond is not enough', mode: 'trusted' as const, requireMemberSig: false, bond: 5 * USDC, claims: [25_000_001, 10 * USDC, undefined], houseClaim: 31 * USDC },
  ];

  for (const c of cases) {
    it(`${c.name} (same result as the mock)`, async () => {
      const real = createSettlementClient(c.mode, env);
      expect(real).toBeInstanceOf(VaultSettlementClient);
      expect(real.mode).toBe(c.mode);
      const opts = { requireMemberSig: c.requireMemberSig, bond: c.bond, claims: c.claims, houseClaim: c.houseClaim, challengeSecs: 3 };

      const allEvents: ChainEvent[] = [];
      const unsubscribe = real.subscribe((e) => allEvents.push(e));
      await sleep(500); // let the websocket subscription land
      const onChain = await scenario(real, opts);
      const mock = await scenario(new MockSettlementClient(c.mode), opts);
      expect({ ...onChain, partyAddress: '' }).toEqual({ ...mock, partyAddress: '' });

      expect(onChain.errors.submitWhileOpen).toBe('party is not closing');
      expect(onChain.errors.finalizeWhileOpen).toBe('party is not closing');
      expect(onChain.errors.closeByStranger).toBe('only the host or the box can close');
      expect(onChain.errors.depositWhileClosing).toBe('party is not open');
      expect(onChain.errors.notAMember).toBe('not a member');
      expect(onChain.errors.badBoxSig).toBe('invalid box signature');
      if (c.requireMemberSig) expect(onChain.errors.noMemberSig).toBe('invalid member signature');
      expect(onChain.errors.withdrawBeforeFinalize).toBe('party is not finalized');
      expect(onChain.errors.doubleWithdraw).toBe('already withdrawn');
      for (const [k, v] of Object.entries(onChain.errors)) if (k.startsWith('stale')) expect(v).toBe('stale nonce');

      // RPC log subscription (the QuickNode Streams fallback) saw every step.
      await sleep(1500);
      unsubscribe();
      // The subscription is program-wide: keep this party only.
      const events = allEvents.filter((e) => e.partyAddress === onChain.partyAddress);
      const kinds = events.map((e) => e.kind);
      expect(kinds.filter((k) => k === 'create_party').length).toBe(1);
      expect(kinds.filter((k) => k === 'deposit').length).toBe(4);
      expect(kinds.filter((k) => k === 'request_close').length).toBe(1);
      expect(kinds.filter((k) => k === 'finalize').length).toBe(1);
      expect(kinds.filter((k) => k === 'withdraw').length).toBe(4);
      expect(kinds.filter((k) => k === 'submit_state').length).toBe(c.claims.filter((x) => x !== undefined).length * 2 + (c.houseClaim === undefined ? 0 : 1));
      for (const e of events) {
        expect(e.via).toBe('rpc');
        expect(e.signature.length).toBeGreaterThan(40);
        expect(e.explorerUrl).toContain(e.signature);
        expect(e.slot).toBeGreaterThan(0);
      }
      const deposits = events.filter((e) => e.kind === 'deposit');
      expect(deposits.map((d) => d.amount).sort()).toEqual([10 * USDC, 10 * USDC, 10 * USDC, 20 * USDC].sort());
      const withdrawals = events.filter((e) => e.kind === 'withdraw').map((e) => e.amount);
      expect(withdrawals.slice(0, 3)).toEqual(onChain.withdrawn);
    });
  }

  it('deposit signing: the phone signs the message bytes; bad or missing signatures are refused', async () => {
    const client = createSettlementClient('vault', env) as VaultSettlementClient;
    const host = generateKeyPair();
    const box = generateKeyPair();
    const alice = generateKeyPair();
    const params = { partyId: `dep-${Date.now()}`, hostSecretKey: host.secretKey, boxSigner: box.publicKey, bond: 5 * USDC, challengeSecs: 60, requireMemberSig: true };
    const created = await client.createParty(params);
    expect(created.txSig).toBeTruthy();
    expect(created.partyAddress).toBe(client.partyAddressFor(host.publicKey, params.partyId));
    // Idempotent: asking again returns the same party and sends nothing.
    expect(await client.createParty(params)).toEqual({ partyAddress: created.partyAddress });
    expect((await client.getParty(created.partyAddress))?.bond).toBe(5_000_000n);

    // No USDC yet.
    expect(await client.walletBalance(alice.publicKey)).toBe(0);
    expect(await errorOf(client.prepareDeposit({ partyAddress: created.partyAddress, member: alice.publicKey, amount: 10 * USDC }))).toContain('insufficient USDC balance');
    await client.faucet(alice.publicKey, 25 * USDC);

    const req = await client.prepareDeposit({ partyAddress: created.partyAddress, member: alice.publicKey, amount: 10 * USDC });
    expect(req.messageB64).toBeTruthy();
    const message = b64decode(req.messageB64 as string);
    const mallory = generateKeyPair();
    expect(await errorOf(client.submitDeposit({ depositId: req.depositId }))).toBe('member signature required');
    expect(await errorOf(client.submitDeposit({ depositId: req.depositId, memberSignatureB64: b64encode(nacl.sign.detached(message, mallory.secretKey)) }))).toBe('invalid member signature');
    expect(await errorOf(client.submitDeposit({ depositId: 'nope', memberSignatureB64: 'AA==' }))).toBe('unknown deposit');

    const ok = await client.submitDeposit({ depositId: req.depositId, memberSignatureB64: b64encode(nacl.sign.detached(message, alice.secretKey)) });
    expect(ok.amount).toBe(10 * USDC);
    expect(ok.txSig).toBeTruthy();
    // One shot.
    expect(await errorOf(client.submitDeposit({ depositId: req.depositId, memberSignatureB64: b64encode(nacl.sign.detached(message, alice.secretKey)) }))).toBe('unknown deposit');

    expect(await client.walletBalance(alice.publicKey)).toBe(15 * USDC);
    expect((await client.getMember(created.partyAddress, alice.publicKey))?.deposited).toBe(10_000_000n);
    // Alice never held SOL: the treasury paid the fee and the Member account rent.
    expect(await client.connection.getBalance(new PublicKey(alice.publicKey))).toBe(0);
  });

  it('finalize refuses while the challenge window is far from over', async () => {
    const client = createSettlementClient('vault', env) as VaultSettlementClient;
    const host = generateKeyPair();
    const box = generateKeyPair();
    const { partyAddress } = await client.createParty({ partyId: `win-${Date.now()}`, hostSecretKey: host.secretKey, boxSigner: box.publicKey, bond: USDC, challengeSecs: 3600, requireMemberSig: true });
    const closed = await client.requestClose(partyAddress, host.secretKey);
    expect(Math.abs(Date.parse(closed.challengeEndsAt) - (Date.now() + 3600_000))).toBeLessThan(5000);
    // Closing twice is harmless and reports the same deadline (to within clock jitter).
    const again = await client.requestClose(partyAddress, box.secretKey);
    expect(again.txSig).toBeUndefined();
    expect(Math.abs(Date.parse(again.challengeEndsAt) - Date.parse(closed.challengeEndsAt))).toBeLessThan(5000);
    expect(await errorOf(client.finalize(partyAddress))).toBe('challenge window still open');
  });
});
