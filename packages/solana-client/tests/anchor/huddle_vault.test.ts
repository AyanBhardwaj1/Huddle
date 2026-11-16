import { settleClaims } from '@huddle/shared';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { Ed25519Program, Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ataOf, depositIx, ed25519VerifyIx, finalizeIx, findMemberPda, findVaultPda, withdrawHostIx, withdrawIx } from '../../src';
import {
  HAS_VALIDATOR,
  PROGRAM_ID,
  USDC,
  createParty,
  deposit,
  failure,
  fund,
  getMember,
  getParty,
  join,
  requestClose,
  send,
  setup,
  sigOver,
  stateMessage,
  submitIx,
  submitState,
  tokenBalance,
  usdcOf,
  waitForWindow,
  type Ctx,
  type TestParty,
} from '../helpers';

/**
 * On-chain tests for the huddle_vault program, run by `anchor test --validator legacy`
 * (see Anchor.toml and scripts/solana-test.sh). Skipped when no validator is configured.
 */
describe.skipIf(!HAS_VALIDATOR)('huddle_vault program', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await setup();
  }, 60_000);

  const finalize = (p: TestParty) => send(ctx, [finalizeIx({ programId: PROGRAM_ID, party: p.party })]);
  const withdraw = (p: TestParty, wallet: Keypair) =>
    send(ctx, [withdrawIx({ programId: PROGRAM_ID, payer: ctx.payer.publicKey, party: p.party, wallet: wallet.publicKey, mint: ctx.mint })]);
  const withdrawHost = (p: TestParty) =>
    send(ctx, [withdrawHostIx({ programId: PROGRAM_ID, payer: ctx.payer.publicKey, party: p.party, host: p.host.publicKey, mint: ctx.mint })]);
  const closeAndWait = async (p: TestParty) => {
    await requestClose(ctx, p, p.box);
    await waitForWindow(ctx, p.party);
  };

  describe('create_party and deposit', () => {
    it('creates the party, moves the bond into a vault owned by the party PDA', async () => {
      const p = await createParty(ctx, { bond: 5 * USDC, challengeSecs: 60 });
      const party = await getParty(ctx, p.party);
      expect(party.host.equals(p.host.publicKey)).toBe(true);
      expect(party.boxSigner.equals(p.box.publicKey)).toBe(true);
      expect(party.mint.equals(ctx.mint)).toBe(true);
      expect(party.vault.equals(findVaultPda(PROGRAM_ID, p.party)[0])).toBe(true);
      expect(party.status).toBe('open');
      expect(party.bond).toBe(5_000_000n);
      expect(party.challengeSecs).toBe(60);
      expect(party.requireMemberSig).toBe(true);
      expect(party.memberCount).toBe(0);
      expect(await tokenBalance(ctx, p.vault)).toBe(5 * USDC);
      expect(await usdcOf(ctx, p.host.publicKey)).toBe(0);
      // The host key never held SOL: the payer (treasury) paid rent and fees.
      expect(await ctx.conn.getBalance(p.host.publicKey)).toBe(0);
    });

    it('deposit creates the Member account; the member needs no SOL; deposits add up', async () => {
      const p = await createParty(ctx);
      const alice = Keypair.generate();
      await fund(ctx, alice.publicKey, 25 * USDC);
      expect(await ctx.conn.getBalance(alice.publicKey)).toBe(0);

      await deposit(ctx, p, alice, 10 * USDC);
      let m = await getMember(ctx, p.party, alice.publicKey);
      expect(m.wallet.equals(alice.publicKey)).toBe(true);
      expect(m.party.equals(p.party)).toBe(true);
      expect(m.deposited).toBe(10_000_000n);
      expect(m.hasClaim).toBe(false);
      expect(m.withdrawn).toBe(false);

      await deposit(ctx, p, alice, 5 * USDC);
      m = await getMember(ctx, p.party, alice.publicKey);
      expect(m.deposited).toBe(15_000_000n);

      const party = await getParty(ctx, p.party);
      expect(party.memberCount).toBe(1);
      expect(party.totalDeposits).toBe(15_000_000n);
      expect(await tokenBalance(ctx, p.vault)).toBe(p.bond + 15 * USDC);
      expect(await usdcOf(ctx, alice.publicKey)).toBe(10 * USDC);
      expect(await ctx.conn.getBalance(alice.publicKey)).toBe(0);
    });

    it('rejects a zero deposit, a deposit without the member signature, and a deposit after close', async () => {
      const p = await createParty(ctx);
      const alice = Keypair.generate();
      await fund(ctx, alice.publicKey, 20 * USDC);
      expect((await failure(deposit(ctx, p, alice, 0))).code).toBe('ZeroAmount');

      // Someone else cannot deposit "for" alice out of alice's token account.
      const mallory = Keypair.generate();
      const forged = depositIx({
        programId: PROGRAM_ID,
        payer: ctx.payer.publicKey,
        member: mallory.publicKey,
        party: p.party,
        mint: ctx.mint,
        memberToken: ataOf(ctx.mint, alice.publicKey),
        amount: USDC,
      });
      await failure(send(ctx, [forged], [mallory]));

      await requestClose(ctx, p, p.host);
      expect((await failure(deposit(ctx, p, alice, USDC))).code).toBe('PartyNotOpen');
    });
  });

  describe('request_close', () => {
    it('only the host or the box can close early; a member must wait for the timeout', async () => {
      const p = await createParty(ctx);
      const alice = await join(ctx, p, 10 * USDC);

      const stranger = Keypair.generate();
      expect((await failure(requestClose(ctx, p, stranger))).code).toBe('NotAuthorizedToClose');
      // A stranger cannot borrow alice's Member account either (seeds bind it to the signer).
      await failure(
        send(
          ctx,
          [
            new TransactionInstruction({
              programId: PROGRAM_ID,
              keys: [
                { pubkey: stranger.publicKey, isSigner: true, isWritable: false },
                { pubkey: p.party, isSigner: false, isWritable: true },
                { pubkey: findMemberPda(PROGRAM_ID, p.party, alice.publicKey)[0], isSigner: false, isWritable: false },
              ],
              data: Buffer.from([82, 168, 167, 86, 14, 15, 199, 180]),
            }),
          ],
          [stranger],
        ),
      );
      expect((await failure(requestClose(ctx, p, alice, true))).code).toBe('MemberCloseTooEarly');
      expect((await getParty(ctx, p.party)).status).toBe('open');

      await requestClose(ctx, p, p.box);
      const party = await getParty(ctx, p.party);
      expect(party.status).toBe('closing');
      expect(party.closeRequestedAt).toBeGreaterThan(0);
      expect((await failure(requestClose(ctx, p, p.host))).code).toBe('PartyNotOpen');
    });
  });

  describe('submit_state', () => {
    it('accepts a state signed by the box and the member (one Ed25519 instruction)', async () => {
      const p = await createParty(ctx, { challengeSecs: 60 });
      const alice = await join(ctx, p, 10 * USDC);
      const f = { party: p.party, member: alice.publicKey, nonce: 37, balance: 14_200_000 };

      expect((await failure(submitState(ctx, f, [p.box, alice]))).code).toBe('PartyNotClosing');
      await requestClose(ctx, p, p.box);
      await submitState(ctx, f, [p.box, alice]);

      const m = await getMember(ctx, p.party, alice.publicKey);
      expect(m.hasClaim).toBe(true);
      expect(m.claimNonce).toBe(37n);
      expect(m.claimBalance).toBe(14_200_000n);
      expect([...m.claimStateHash]).toEqual(new Array(32).fill(7));
      const party = await getParty(ctx, p.party);
      expect(party.claimsCount).toBe(1);
      expect(party.sumClaims).toBe(14_200_000n);
      expect(party.claimedDeposits).toBe(10_000_000n);
    });

    it('accepts the standard layout too: one web3.js Ed25519 instruction per signature', async () => {
      const p = await createParty(ctx, { challengeSecs: 60 });
      const alice = await join(ctx, p, 10 * USDC);
      await requestClose(ctx, p, p.box);
      const f = { party: p.party, member: alice.publicKey, nonce: 1, balance: 9 * USDC };
      const message = stateMessage(f);
      await send(ctx, [
        Ed25519Program.createInstructionWithPrivateKey({ privateKey: p.box.secretKey, message }),
        Ed25519Program.createInstructionWithPrivateKey({ privateKey: alice.secretKey, message }),
        submitIx(f),
      ]);
      expect((await getMember(ctx, p.party, alice.publicKey)).claimBalance).toBe(9_000_000n);
    });

    it('rejects missing or wrong signatures and wrong messages', async () => {
      const p = await createParty(ctx, { challengeSecs: 60 });
      const other = await createParty(ctx, { challengeSecs: 60 });
      const alice = await join(ctx, p, 10 * USDC);
      await requestClose(ctx, p, p.box);
      const f = { party: p.party, member: alice.publicKey, nonce: 5, balance: 30 * USDC };
      const message = stateMessage(f);
      const mallory = Keypair.generate();

      // No Ed25519 instruction at all.
      expect((await failure(send(ctx, [submitIx(f)]))).code).toBe('MissingBoxSignature');
      // Member signature only.
      expect((await failure(submitState(ctx, f, [alice]))).code).toBe('MissingBoxSignature');
      // Box signature only, in a party that requires the member's signature.
      expect((await failure(submitState(ctx, f, [p.box]))).code).toBe('MissingMemberSignature');
      // A valid signature, but by a key that is not the box signer.
      expect((await failure(submitState(ctx, f, [mallory, alice]))).code).toBe('MissingBoxSignature');
      // Somebody else "countersigning" for the member.
      expect((await failure(submitState(ctx, f, [p.box, mallory]))).code).toBe('MissingMemberSignature');

      // A forged box signature: the Ed25519 program itself fails the whole transaction.
      const forged = { publicKey: p.box.publicKey.toBytes(), signature: sigOver(message, mallory).signature };
      const forgedFailure = await failure(send(ctx, [ed25519VerifyIx([forged, sigOver(message, alice)], message), submitIx(f)]));
      expect(forgedFailure.code).toBeUndefined();

      // Wrong message: both really signed balance 1 USDC, the instruction claims 30 USDC.
      const small = stateMessage({ ...f, balance: USDC });
      expect(
        (await failure(send(ctx, [ed25519VerifyIx([sigOver(small, p.box), sigOver(small, alice)], small), submitIx(f)]))).code,
      ).toBe('MissingBoxSignature');
      // Wrong nonce in the signed message.
      const otherNonce = stateMessage({ ...f, nonce: 6 });
      expect(
        (await failure(send(ctx, [ed25519VerifyIx([sigOver(otherNonce, p.box), sigOver(otherNonce, alice)], otherNonce), submitIx(f)])))
          .code,
      ).toBe('MissingBoxSignature');
      // Replay of a state signed for a different party.
      const elsewhere = stateMessage({ ...f, party: other.party });
      expect(
        (await failure(send(ctx, [ed25519VerifyIx([sigOver(elsewhere, p.box), sigOver(elsewhere, alice)], elsewhere), submitIx(f)])))
          .code,
      ).toBe('MissingBoxSignature');
      // The Ed25519 instruction placed after submit_state does not count.
      expect(
        (await failure(send(ctx, [submitIx(f), ed25519VerifyIx([sigOver(message, p.box), sigOver(message, alice)], message)]))).code,
      ).toBe('MissingBoxSignature');

      expect((await getMember(ctx, p.party, alice.publicKey)).hasClaim).toBe(false);
    });

    it('rejects an Ed25519 instruction whose offsets point into another instruction', async () => {
      const p = await createParty(ctx, { challengeSecs: 60 });
      const alice = await join(ctx, p, 10 * USDC);
      await requestClose(ctx, p, p.box);
      const f = { party: p.party, member: alice.publicKey, nonce: 5, balance: 30 * USDC };
      const message = stateMessage(f);
      const mallory = Keypair.generate();

      // Instruction 0: a real, valid signature by mallory over the message.
      const real = ed25519VerifyIx([sigOver(message, mallory)], message);
      // Instruction 1: its own bytes say "box signer + message" at the usual offsets, but every
      // instruction index points at instruction 0, so the runtime verifies mallory's data instead.
      const decoyData = Buffer.from(ed25519VerifyIx([{ publicKey: p.box.publicKey.toBytes(), signature: new Uint8Array(64) }], message).data);
      for (const fieldOffset of [4, 8, 14]) decoyData.writeUInt16LE(0, fieldOffset);
      const decoy = new TransactionInstruction({ programId: Ed25519Program.programId, keys: [], data: decoyData });
      // Same trick for the member signature.
      const decoyMemberData = Buffer.from(
        ed25519VerifyIx([{ publicKey: alice.publicKey.toBytes(), signature: new Uint8Array(64) }], message).data,
      );
      for (const fieldOffset of [4, 8, 14]) decoyMemberData.writeUInt16LE(0, fieldOffset);
      const decoyMember = new TransactionInstruction({ programId: Ed25519Program.programId, keys: [], data: decoyMemberData });

      const err = await failure(send(ctx, [real, decoy, decoyMember, submitIx(f)]));
      expect(err.code).toBe('MissingBoxSignature');
      expect((await getMember(ctx, p.party, alice.publicKey)).hasClaim).toBe(false);
    });

    it('higher nonce wins, stale and equal nonces are rejected', async () => {
      const p = await createParty(ctx, { challengeSecs: 60 });
      const alice = await join(ctx, p, 10 * USDC);
      const bob = await join(ctx, p, 10 * USDC);
      await requestClose(ctx, p, p.box);

      await submitState(ctx, { party: p.party, member: alice.publicKey, nonce: 10, balance: 12 * USDC }, [p.box, alice]);
      await submitState(ctx, { party: p.party, member: bob.publicKey, nonce: 3, balance: 8 * USDC }, [p.box, bob]);
      expect((await getParty(ctx, p.party)).sumClaims).toBe(20_000_000n);

      // Stale (the box tries an older, higher balance) and equal nonces are refused.
      expect(
        (await failure(submitState(ctx, { party: p.party, member: alice.publicKey, nonce: 9, balance: 19 * USDC }, [p.box, alice]))).code,
      ).toBe('StaleNonce');
      expect(
        (await failure(submitState(ctx, { party: p.party, member: alice.publicKey, nonce: 10, balance: 19 * USDC }, [p.box, alice]))).code,
      ).toBe('StaleNonce');

      // A newer state replaces the claim and the running sums follow.
      await submitState(ctx, { party: p.party, member: alice.publicKey, nonce: 11, balance: 7 * USDC }, [p.box, alice]);
      const m = await getMember(ctx, p.party, alice.publicKey);
      expect(m.claimNonce).toBe(11n);
      expect(m.claimBalance).toBe(7_000_000n);
      const party = await getParty(ctx, p.party);
      expect(party.sumClaims).toBe(15_000_000n);
      expect(party.claimsCount).toBe(2);
      expect(party.claimedDeposits).toBe(20_000_000n);
    });

    it('trusted-host mode (require_member_sig = false): the box signature alone is enough', async () => {
      const p = await createParty(ctx, { challengeSecs: 60, requireMemberSig: false });
      const alice = await join(ctx, p, 10 * USDC);
      await requestClose(ctx, p, p.box);
      const f = { party: p.party, member: alice.publicKey, nonce: 4, balance: 6 * USDC };
      // Still needs the box.
      expect((await failure(submitState(ctx, f, [alice]))).code).toBe('MissingBoxSignature');
      await submitState(ctx, f, [p.box]);
      const m = await getMember(ctx, p.party, alice.publicKey);
      expect(m.hasClaim).toBe(true);
      expect(m.claimBalance).toBe(6_000_000n);
    });
  });

  describe('finalize and withdraw', () => {
    it('finalize is rejected while open and before the challenge window ends; withdraw before finalize', async () => {
      const p = await createParty(ctx, { challengeSecs: 3600 });
      const alice = await join(ctx, p, 10 * USDC);
      expect((await failure(finalize(p))).code).toBe('PartyNotClosing');
      expect((await failure(withdraw(p, alice))).code).toBe('PartyNotFinalized');
      await requestClose(ctx, p, p.box);
      expect((await failure(finalize(p))).code).toBe('ChallengeWindowOpen');
      expect((await failure(withdraw(p, alice))).code).toBe('PartyNotFinalized');
      expect((await failure(withdrawHost(p))).code).toBe('PartyNotFinalized');
      expect((await getParty(ctx, p.party)).status).toBe('closing');
    });

    it('pays everyone in full when claims fit; bond + surplus go to the host; no double withdraw', async () => {
      const p = await createParty(ctx, { bond: 5 * USDC });
      const alice = await join(ctx, p, 10 * USDC);
      const bob = await join(ctx, p, 10 * USDC);
      const carol = await join(ctx, p, 10 * USDC); // never submits: defaults to her deposit
      await requestClose(ctx, p, p.box);
      await submitState(ctx, { party: p.party, member: alice.publicKey, nonce: 8, balance: 14 * USDC }, [p.box, alice]);
      await submitState(ctx, { party: p.party, member: bob.publicKey, nonce: 8, balance: 4 * USDC }, [p.box, bob]);
      await waitForWindow(ctx, p.party);
      await finalize(p);

      const expected = settleClaims({
        deposits: { a: 10 * USDC, b: 10 * USDC, c: 10 * USDC },
        claims: { a: 14 * USDC, b: 4 * USDC },
        bond: 5 * USDC,
      });
      const party = await getParty(ctx, p.party);
      expect(party.status).toBe('finalized');
      expect(party.cut).toBe(false);
      expect(party.finalizedSum).toBe(28_000_000n);
      expect(Number(party.hostRefund)).toBe(expected.hostRefund); // 5 bond + 2 surplus
      expect(expected.hostRefund).toBe(7 * USDC);
      expect((await failure(finalize(p))).code).toBe('PartyNotClosing');
      expect((await failure(submitState(ctx, { party: p.party, member: carol.publicKey, nonce: 1, balance: 30 * USDC }, [p.box, carol]))).code).toBe(
        'PartyNotClosing',
      );

      // Anyone can crank; the money lands in each member's own associated token account.
      await withdraw(p, alice);
      await withdraw(p, bob);
      await withdraw(p, carol);
      expect(await usdcOf(ctx, alice.publicKey)).toBe(expected.payouts.a);
      expect(await usdcOf(ctx, bob.publicKey)).toBe(expected.payouts.b);
      expect(await usdcOf(ctx, carol.publicKey)).toBe(expected.payouts.c);
      expect((await getMember(ctx, p.party, alice.publicKey)).paidOut).toBe(14_000_000n);
      expect((await failure(withdraw(p, alice))).code).toBe('AlreadyWithdrawn');
      expect(await usdcOf(ctx, alice.publicKey)).toBe(14 * USDC);

      await withdrawHost(p);
      expect(await usdcOf(ctx, p.host.publicKey)).toBe(7 * USDC);
      expect(await tokenBalance(ctx, p.vault)).toBe(0);
      expect((await failure(withdrawHost(p))).code).toBe('NothingToWithdraw');
    });

    it('the host can take its refund before the members withdraw, and only once', async () => {
      const p = await createParty(ctx, { bond: 5 * USDC });
      const alice = await join(ctx, p, 10 * USDC);
      await closeAndWait(p);
      await finalize(p);
      await withdrawHost(p);
      expect(await usdcOf(ctx, p.host.publicKey)).toBe(5 * USDC);
      expect((await failure(withdrawHost(p))).code).toBe('NothingToWithdraw');
      expect(await tokenBalance(ctx, p.vault)).toBe(10 * USDC);
      await withdraw(p, alice);
      expect(await usdcOf(ctx, alice.publicKey)).toBe(10 * USDC);
      expect(await tokenBalance(ctx, p.vault)).toBe(0);
    });

    it('the bond covers a shortfall', async () => {
      const p = await createParty(ctx, { bond: 5 * USDC });
      const alice = await join(ctx, p, 10 * USDC);
      const bob = await join(ctx, p, 10 * USDC); // loser whose state was never submitted: defaults to 10
      await requestClose(ctx, p, p.box);
      await submitState(ctx, { party: p.party, member: alice.publicKey, nonce: 2, balance: 13 * USDC }, [p.box, alice]);
      await waitForWindow(ctx, p.party);
      await finalize(p);

      const expected = settleClaims({ deposits: { a: 10 * USDC, b: 10 * USDC }, claims: { a: 13 * USDC }, bond: 5 * USDC });
      expect(expected.cut).toBe(false);
      expect(expected.shortfall).toBe(3 * USDC);
      const party = await getParty(ctx, p.party);
      expect(party.cut).toBe(false);
      expect(Number(party.hostRefund)).toBe(expected.hostRefund); // 2 USDC of the bond is left

      await withdraw(p, alice);
      await withdraw(p, bob);
      await withdrawHost(p);
      expect(await usdcOf(ctx, alice.publicKey)).toBe(13 * USDC);
      expect(await usdcOf(ctx, bob.publicKey)).toBe(10 * USDC);
      expect(await usdcOf(ctx, p.host.publicKey)).toBe(2 * USDC);
      expect(await tokenBalance(ctx, p.vault)).toBe(0);
    });

    it('cuts every claim pro rata (rounded down) when the bond is not enough; dust goes to the host', async () => {
      const p = await createParty(ctx, { bond: 5 * USDC });
      const alice = await join(ctx, p, 10 * USDC);
      const bob = await join(ctx, p, 10 * USDC);
      const carol = await join(ctx, p, 10 * USDC); // no claim: defaults to her deposit, cut like the rest
      await requestClose(ctx, p, p.box);
      await submitState(ctx, { party: p.party, member: alice.publicKey, nonce: 9, balance: 25_000_001 }, [p.box, alice]);
      await submitState(ctx, { party: p.party, member: bob.publicKey, nonce: 9, balance: 10 * USDC }, [p.box, bob]);
      await waitForWindow(ctx, p.party);
      await finalize(p);

      const expected = settleClaims({
        deposits: { a: 10 * USDC, b: 10 * USDC, c: 10 * USDC },
        claims: { a: 25_000_001, b: 10 * USDC },
        bond: 5 * USDC,
      });
      expect(expected.cut).toBe(true);
      const party = await getParty(ctx, p.party);
      expect(party.cut).toBe(true);
      expect(party.available).toBe(35_000_000n);
      expect(party.finalizedSum).toBe(45_000_001n);
      expect(party.hostRefund).toBe(0n);

      // Nothing for the host until every member has been paid.
      expect((await failure(withdrawHost(p))).code).toBe('NothingToWithdraw');
      await withdraw(p, alice);
      await withdraw(p, bob);
      expect((await failure(withdrawHost(p))).code).toBe('NothingToWithdraw');
      await withdraw(p, carol);

      expect(await usdcOf(ctx, alice.publicKey)).toBe(expected.payouts.a);
      expect(await usdcOf(ctx, bob.publicKey)).toBe(expected.payouts.b);
      expect(await usdcOf(ctx, carol.publicKey)).toBe(expected.payouts.c);
      expect(expected.payouts.a).toBe(Math.floor((25_000_001 * 35_000_000) / 45_000_001));
      expect(expected.payouts.a! + expected.payouts.b! + expected.payouts.c!).toBeLessThanOrEqual(35 * USDC);

      // The rounding dust is all that is left; it goes to the host.
      expect(expected.hostRefund).toBeGreaterThan(0);
      expect(await tokenBalance(ctx, p.vault)).toBe(expected.hostRefund);
      await withdrawHost(p);
      expect(await usdcOf(ctx, p.host.publicKey)).toBe(expected.hostRefund);
      expect(await tokenBalance(ctx, p.vault)).toBe(0);
      expect((await failure(withdraw(p, bob))).code).toBe('AlreadyWithdrawn');
    });

    it('a payout can only go to the member’s own associated token account', async () => {
      const p = await createParty(ctx, { bond: 0 });
      const alice = await join(ctx, p, 10 * USDC);
      await closeAndWait(p);
      await finalize(p);

      const thief = Keypair.generate();
      await send(ctx, [createAssociatedTokenAccountIdempotentInstruction(ctx.payer.publicKey, ataOf(ctx.mint, thief.publicKey), thief.publicKey, ctx.mint)]);
      const ix = withdrawIx({ programId: PROGRAM_ID, payer: ctx.payer.publicKey, party: p.party, wallet: alice.publicKey, mint: ctx.mint });
      // Swap the destination (account #6, wallet_token) for the thief's token account.
      (ix.keys[6] as { pubkey: unknown }).pubkey = ataOf(ctx.mint, thief.publicKey);
      await failure(send(ctx, [ix]));
      // Same for the host refund (account #5, host_token); here there is nothing owed anyway (bond 0).
      const hostIx = withdrawHostIx({ programId: PROGRAM_ID, payer: ctx.payer.publicKey, party: p.party, host: thief.publicKey, mint: ctx.mint });
      await failure(send(ctx, [hostIx]));
      expect(await usdcOf(ctx, thief.publicKey)).toBe(0);

      await withdraw(p, alice);
      expect(await usdcOf(ctx, alice.publicKey)).toBe(10 * USDC);
      expect(SystemProgram.programId.equals(ix.keys[9]!.pubkey)).toBe(true);
    });
  });
});
