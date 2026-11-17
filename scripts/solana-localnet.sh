#!/bin/sh
# Run Huddle with REAL on-chain settlement on a local Solana validator (no devnet SOL needed).
#
#   sh scripts/solana-localnet.sh            # build if needed, start validator + engine in vault mode
#   sh scripts/solana-localnet.sh --no-engine  # only the validator + setup; prints the env to use
#
# What it does:
#   1. builds programs/huddle_vault if target/deploy/huddle_vault.so is missing
#   2. starts solana-test-validator with the program preloaded at its real program ID
#   3. runs scripts/solana-setup.ts against it (treasury, box signer, 6-decimal test USDC mint)
#   4. starts the engine with SETTLEMENT=vault pointed at the local validator
#
# Then open http://localhost:${PORT:-8080}/box/ and create a party with "Vault" selected. Deposits,
# close, signed-balance submission, finalize and withdrawals are real transactions on the local chain.
# Ctrl-C stops the engine and the validator. Keys live in keys/localnet (gitignored).
set -e
cd "$(dirname "$0")/.."
. scripts/solana-env.sh

PROGRAM_ID=GRpABdrQhDya9n2zuf19w2idbL3CRSqmWYTJs52taRHu
RPC=http://127.0.0.1:8899
KEYS=keys/localnet
LEDGER="${TMPDIR:-/tmp}/huddle-localnet-ledger"

if [ ! -f target/deploy/huddle_vault.so ]; then
  echo "==> Building huddle_vault (first run only)"
  anchor build
fi

echo "==> Starting solana-test-validator"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --bpf-program "$PROGRAM_ID" target/deploy/huddle_vault.so >/dev/null 2>&1 &
VALIDATOR_PID=$!
cleanup() {
  kill "$VALIDATOR_PID" 2>/dev/null || true
  rm -rf "$LEDGER"
}
trap cleanup EXIT INT TERM

i=0
until solana -u "$RPC" cluster-version >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then echo "validator did not start" >&2; exit 1; fi
  sleep 1
done

echo "==> Treasury, box signer and test USDC mint"
mkdir -p "$KEYS"
# Fund the treasury straight from the local faucet (it pays every fee and all account rent).
[ -f "$KEYS/treasury-keypair.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYS/treasury-keypair.json" >/dev/null
solana -u "$RPC" airdrop 100 "$(solana-keygen pubkey "$KEYS/treasury-keypair.json")" >/dev/null
if ! SOLANA_RPC_URL="$RPC" SOLANA_CLUSTER=localnet HUDDLE_KEYS_DIR="$KEYS" HUDDLE_MIN_SOL=3 \
  pnpm --silent tsx scripts/solana-setup.ts >"$KEYS/setup.log" 2>&1; then
  echo "setup failed:" >&2
  tail -20 "$KEYS/setup.log" >&2
  exit 1
fi
MINT=$(solana-keygen pubkey "$KEYS/usdc-test-mint-keypair.json")

export SOLANA_RPC_URL="$RPC"
export SOLANA_CLUSTER=localnet
export HUDDLE_PROGRAM_ID="$PROGRAM_ID"
export USDC_MINT="$MINT"
export SETTLEMENT=vault
TREASURY_SECRET_KEY=$(cat "$KEYS/treasury-keypair.json")
BOX_SIGNER_SECRET_KEY=$(cat "$KEYS/box-signer-keypair.json")
export TREASURY_SECRET_KEY BOX_SIGNER_SECRET_KEY

echo "    program:  $PROGRAM_ID"
echo "    USDC mint: $MINT (test mint, treasury is the mint authority)"
echo "    rpc:      $RPC"

if [ "$1" = "--no-engine" ]; then
  echo
  echo "Validator is running. In another shell, start the engine with:"
  echo "  SOLANA_RPC_URL=$RPC SOLANA_CLUSTER=localnet HUDDLE_PROGRAM_ID=$PROGRAM_ID USDC_MINT=$MINT SETTLEMENT=vault \\"
  echo "  TREASURY_SECRET_KEY=\"\$(cat $KEYS/treasury-keypair.json)\" BOX_SIGNER_SECRET_KEY=\"\$(cat $KEYS/box-signer-keypair.json)\" \\"
  echo "  pnpm --filter @huddle/engine start"
  echo "Ctrl-C here stops the validator."
  wait "$VALIDATOR_PID"
  exit 0
fi

echo "==> Engine in vault mode (http://localhost:${PORT:-8080}/box/)"
pnpm --filter @huddle/engine start
