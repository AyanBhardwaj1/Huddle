#!/bin/sh
# Build huddle_vault, start a local solana-test-validator with it loaded, and run every on-chain test
# (program tests + the SettlementClient integration test) in packages/solana-client/tests.
#
#   sh scripts/solana-test.sh              # build + test
#   sh scripts/solana-test.sh --skip-build # reuse target/deploy/huddle_vault.so
#
# The validator is started and stopped by `anchor test`. Nothing touches devnet.
set -e
cd "$(dirname "$0")/.."
. scripts/solana-env.sh

# Throwaway localnet wallet so `anchor test` does not depend on ~/.config/solana/id.json.
WALLET=target/localnet-wallet-keypair.json
mkdir -p target
[ -f "$WALLET" ] || solana-keygen new --no-bip39-passphrase --silent -o "$WALLET" >/dev/null

exec anchor test --validator legacy --provider.wallet "$WALLET" "$@"
