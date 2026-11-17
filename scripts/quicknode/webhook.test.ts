import crypto from 'node:crypto';
import { startEngine, type EngineHandle } from '@huddle/engine';
import { HuddleClient, generateKeyPair, wsUrlFor, type ChainEvent, type ServerMessage } from '@huddle/shared';
import { depositIx } from '@huddle/solana-client';
import { PublicKey } from '@solana/web3.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockTx, loadFilter } from './harness';

/**
 * Streams end to end without QuickNode: a synthetic devnet block -> filter.js -> POST to a running
 * engine's /webhooks/quicknode, signed the way QuickNode signs webhooks
 * (X-QN-Signature = hex HMAC-SHA256(security token, nonce + timestamp + body)) -> deposit credited.
 */

const SECRET = 'qn-security-token-for-tests-0123456789';
const USDC = 1_000_000;
let engine: EngineHandle;

beforeAll(async () => {
  engine = await startEngine({
    port: 0,
    host: '127.0.0.1',
    dataDir: ':memory:',
    logger: false,
    env: { SETTLEMENT: 'points', SPORTS_PROVIDER: 'replay', GEMINI_MOCK: '1', QUICKNODE_STREAM_SECRET: SECRET, HUDDLE_NO_LAN: '1' },
    timing: { geminiRefreshMs: 0 },
  });
});
afterAll(async () => {
  await engine?.close();
});

function post(body: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${engine.url}/webhooks/quicknode`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
}
function signed(body: string, secret = SECRET): Record<string, string> {
  const nonce = crypto.randomBytes(8).toString('hex');
  const ts = String(Math.floor(Date.now() / 1000));
  return { 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': crypto.createHmac('sha256', secret).update(nonce + ts + body).digest('hex') };
}
async function until(pred: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('QuickNode webhook -> engine', () => {
  it('credits a deposit the filter extracted from a block, once, and only with a valid signature', async () => {
    const created = await fetch(`${engine.url}/parties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'replay-por-esp', settlement: 'points', buyIn: 10 }),
    });
    expect(created.status).toBe(200);
    const { party } = (await created.json()) as { party: { code: string; chain: { partyAddress: string } } };

    const kp = generateKeyPair();
    const events: ChainEvent[] = [];
    const client = new HuddleClient({
      url: wsUrlFor(engine.url),
      partyCode: party.code,
      role: 'player',
      keyPair: kp,
      name: 'Ayan',
      reconnect: false,
      onMessage: (m: ServerMessage) => {
        if (m.type === 'chain_event') events.push(m.event);
      },
    });
    client.connect();
    await client.ready();
    await client.buyIn(10 * USDC);
    const balance = () => client.getView().snapshot?.you?.state?.balance ?? 0;
    expect(balance()).toBe(10 * USDC);

    // A devnet block with one successful top-up deposit of 3 USDC to this party's vault.
    const programId = new PublicKey('GRpABdrQhDya9n2zuf19w2idbL3CRSqmWYTJs52taRHu');
    const ix = depositIx({
      programId,
      payer: new PublicKey(generateKeyPair().publicKey),
      member: new PublicKey(kp.publicKey),
      party: new PublicKey(party.chain.partyAddress),
      mint: new PublicKey(generateKeyPair().publicKey),
      amount: 3 * USDC,
    });
    const block = { blockTime: Math.floor(Date.now() / 1000), parentSlot: 420_000_000, transactions: [blockTx([ix], { signature: '5streamsDepositSig' })] };
    const records = loadFilter(programId.toBase58()).main({ data: [block], metadata: { network: 'solana-devnet', dataset: 'block' } });
    expect(records).toHaveLength(1);
    const body = JSON.stringify(records);

    // Wrong or missing signature: refused, nothing credited.
    expect((await post(body, signed(body, 'not-the-token'))).status).toBe(401);
    expect((await post(body, {})).status).toBe(401);
    const tampered = signed(body);
    expect((await post(body.replace('5streamsDepositSig', '5streamsDepositSih'), tampered)).status).toBe(401);
    expect(balance()).toBe(10 * USDC);

    // Signed like QuickNode: credited and broadcast with via "quicknode".
    const res = await post(body, signed(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, received: 1, handled: 1 });
    await until(() => balance() === 13 * USDC, 'webhook credit');
    await until(() => events.some((e) => e.signature === '5streamsDepositSig' && e.via === 'quicknode'), 'chain_event');
    expect(events.find((e) => e.signature === '5streamsDepositSig')).toMatchObject({ kind: 'deposit', member: kp.publicKey, amount: 3 * USDC, slot: 420_000_001 });

    // QuickNode retries deliver the same batch again (also wrapped as {data, metadata}): no double credit.
    const wrapped = JSON.stringify({ data: records, metadata: { stream_id: 'test' } });
    expect((await post(wrapped, signed(wrapped))).status).toBe(200);
    expect((await post(body, signed(body))).status).toBe(200);
    const rest = (await (await fetch(`${engine.url}/parties/${party.code}`)).json()) as { players: { pubkey: string; deposited: number }[] };
    expect(rest.players.find((p) => p.pubkey === kp.publicKey)?.deposited).toBe(13 * USDC);
    expect(balance()).toBe(13 * USDC);
    client.close();
  });
});
