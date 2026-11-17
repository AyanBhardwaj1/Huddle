# QuickNode Stream: configuration

Huddle uses one QuickNode Stream as the primary feed of on-chain vault activity. It tells the box and the phones the moment money moves: a buy-in deposit, the close request, each balance submitted, finalize, and each payout.

| | |
| --- | --- |
| Network | Solana **devnet** |
| Dataset | **Block** (each block as returned by `getBlock`). The filter also accepts the "Programs + Logs" dataset shape. |
| Start | Latest block (follows the chain tip; no backfill) |
| Batch size | 5 blocks |
| Filter | [`scripts/quicknode/filter.js`](../scripts/quicknode/filter.js) |
| Destination | Webhook `POST {PUBLIC_ENGINE_URL}/webhooks/quicknode`, compression none |
| Security | The Stream's security token is `QUICKNODE_STREAM_SECRET` in `.env`. The engine refuses every request whose `X-QN-Signature` is wrong. |
| Program | `HUDDLE_PROGRAM_ID` = `GRpABdrQhDya9n2zuf19w2idbL3CRSqmWYTJs52taRHu`. This ID comes from the program keypair. The program is **not yet deployed to devnet** (see the README). |

## Filter logic

QuickNode calls `main(stream)` once per batch. `stream.data` is an array of blocks and `stream.metadata` holds the network, dataset and batch range. For each block the filter:

1. Skips any transaction whose `meta.err` is set (or whose `meta.status` is `Err`). Only successful transactions are kept.
2. Resolves each instruction's program. It looks up `programIdIndex` in `message.accountKeys` and also includes `meta.loadedAddresses` for v0 transactions. It also accepts `programId` from the `jsonParsed` shape. It keeps only instructions whose program is `HUDDLE_PROGRAM_ID`. Other programs in the same transaction are ignored, such as the Ed25519 verify instruction that precedes `submit_state`.
3. Decodes the Anchor instruction discriminator, `sha256("global:<name>")[0..8]`, from the base58 instruction data. The instructions are `create_party`, `deposit`, `request_close`, `submit_state`, `finalize`, `withdraw` and `withdraw_host`. It then reads the party PDA, the member and the amount from the documented account positions and data offsets. These tables are inlined copies of `packages/solana-client/src/decode.ts`, because filters cannot import. A unit test fails if the two drift apart.
4. Handles `withdraw` specially. Its payout is computed on-chain, so the amount comes from the `Withdrawn` Anchor event in `meta.logMessages`. Only `Program data:` lines logged while huddle_vault itself is executing are trusted.
5. Emits one record per Huddle instruction:

```json
{
  "signature": "5streams…",
  "slot": 420000001,
  "blockTime": 1795000000,
  "instruction": "deposit",
  "accounts": ["<payer>", "<member>", "<party PDA>", "…"],
  "partyPda": "<party PDA>",
  "member": "<member wallet>",
  "amount": 3000000
}
```

`amount` is in USDC base units. It is the bond for `create_party`, the deposit amount, the claimed balance for `submit_state`, and the payout for `withdraw`. It is omitted where there is no amount.

If a batch has nothing of ours, the filter returns `null` and QuickNode skips the delivery.

## What the engine does with it

`POST /webhooks/quicknode` (`apps/engine/src/server.ts`) works as follows:

- It verifies the signature as `X-QN-Signature == hex(HMAC-SHA256(token, X-QN-Nonce + X-QN-Timestamp + raw body))`. A token sent in a header is also accepted, for manual tests. Without `QUICKNODE_STREAM_SECRET` the route is closed.
- It accepts the records as a bare array, nested arrays, or `{ data: [...], metadata }`.
- It routes each record to its party by `partyPda`.
- **Deposits are credited exactly once per signature.** If the engine already confirmed the deposit itself, the Streams copy only re-broadcasts it with `via: "quicknode"`, so screens show Streams as the source. A deposit the engine had not seen yet, such as a top-up made from another device, is credited from the Stream.
- Close, submitted states, finalize and payouts appear as `chain_event` messages. The box shows them in its settlement steps and the phones in "Your winnings are in".

## Why Streams

- Streams pushes events in order, so the box reacts the moment money moves. Nothing polls.
- The filter runs on QuickNode's side, so the box downloads only a few hundred bytes per Huddle transaction instead of every devnet block. This matters for a Raspberry Pi on venue Wi-Fi.
- A deposit made outside the app is still credited, for example a top-up signed elsewhere or a retry after the phone lost connection.
- One Stream covers every party and every box. That is the base for the "Huddle network" view across parties (not built yet).

## Fallback: RPC log subscription

If no Stream is configured, the engine still sees program events. `VaultSettlementClient.subscribe()` (`packages/solana-client/src/client.ts`) subscribes to the program's logs over the RPC WebSocket (`SOLANA_WS_URL`, or one derived from `SOLANA_RPC_URL`). It decodes the same Anchor events with `parseHuddleLogs` and delivers them with `via: "rpc"`. The engine also confirms its own transactions directly (`via: "direct"`). Streams is the primary path. The other two make the demo independent of it.

## Setup

### Option A: script

1. Expose the engine publicly. For example, use the Cloudflare Tunnel unit installed by `scripts/pi-setup.sh`, or `cloudflared tunnel --url http://localhost:8080` on a laptop. Set `PUBLIC_ENGINE_URL` to that HTTPS URL.
2. Put a random token of 32 or more characters in `.env` as `QUICKNODE_STREAM_SECRET`, for example `openssl rand -hex 24`. Put your QuickNode API key in `QUICKNODE_API_KEY`.
3. Run `pnpm quicknode:stream`. It calls `POST https://api.quicknode.com/streams/rest/v1/streams` (header `x-api-key`) with network `solana-devnet`, dataset `block`, the filter base64-encoded with your `HUDDLE_PROGRAM_ID` baked in, batch size 5, and a webhook destination carrying your security token.
4. Use `pnpm quicknode:stream -- --dry-run` to print the request body without calling the API. The token is masked. Without an API key, the script prints the dashboard steps below.

### Option B: dashboard

1. Open dashboard.quicknode.com, go to **Streams** and click **Create Stream**.
2. Pick **Solana**, network **Devnet**, dataset **Block**. Start from the latest block and set batch size 5.
3. Choose to modify the payload with a filter. Paste the whole of `scripts/quicknode/filter.js` and check that `HUDDLE_PROGRAM_ID` at the top matches your program. **Test filter** on a recent block returns `null` unless that block contains a Huddle transaction.
4. Set the destination to **Webhook**, URL `https://<PUBLIC_ENGINE_URL>/webhooks/quicknode`, compression **none**. Copy the security token into `.env` as `QUICKNODE_STREAM_SECRET` and restart the engine.
5. Create the Stream. Buy in from a phone in a vault-mode party. The box flashes the deposit and the chain event shows `via quicknode` within a few seconds.

## What was verified, and what was not

- **Verified locally:**
  - `scripts/quicknode/filter.test.ts` runs `filter.js` in a bare `vm` sandbox (no `require`, no `Buffer`, as on QuickNode). It uses synthetic `getBlock` blocks built with the real instruction builders from `@huddle/solana-client`. It decodes all seven instructions, skips failed transactions and other programs, resolves lookup-table accounts, reads the withdraw payout from the event log, and accepts the `jsonParsed` and "Programs + Logs" shapes.
  - `scripts/quicknode/webhook.test.ts` feeds the filter output to a running engine with QuickNode-style HMAC headers. The deposit is credited once. A wrong token, a missing signature or a tampered body gets a 401. Redelivery does not double-credit.
- **Checked against QuickNode's docs (Nov 16 2026):**
  - the `main(stream)` entry point, with `stream.data` as an array of blocks and `return null` to skip;
  - the Solana Block dataset is `getBlock`-shaped;
  - devnet is supported for Solana Streams;
  - the webhook headers `X-QN-Nonce`, `X-QN-Timestamp` and `X-QN-Signature`, with HMAC-SHA256 hex over nonce + timestamp + payload;
  - the REST endpoint, the `x-api-key` header and the create-stream fields.
- **Not found in the docs:**
  - the exact network string, which we assume is `solana-devnet`;
  - whether `slot` and `meta.err` appear in the block payload. The filter falls back to `parentSlot + 1` and also checks `meta.status`;
  - whether the webhook body wraps filter output in `{ data, metadata }`. The engine accepts both forms.
- **Not done:** no real Stream has been created and nothing has run against devnet. That needs a QuickNode account, a public engine URL, and the devnet deploy (see `STATUS.md` → Needs human).
- The docs list no Solana free-trial limits. The PRD notes that free-trial Solana Streams follow the tip only, so claim the hackathon QuickNode credits if backfill is needed.
