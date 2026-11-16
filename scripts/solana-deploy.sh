#!/bin/sh
# Build huddle_vault and deploy (or upgrade) it on Solana DEVNET, then print the program id and the
# deploy transaction signature.
#
#   sh scripts/solana-deploy.sh               # build + deploy
#   sh scripts/solana-deploy.sh --skip-build  # deploy target/deploy/huddle_vault.so as it is
#
# Needs:  scripts/solana-setup.ts to have run (treasury keypair with ~2 devnet SOL).
# Env:    SOLANA_RPC_URL   default https://api.devnet.solana.com
#         HUDDLE_KEYS_DIR  default ./keys   (treasury-keypair.json, optional huddle_vault-keypair.json)
#
# The treasury pays for the deploy and becomes the upgrade authority. The program address comes from
# the program keypair (first deploy) or from `declare_id!` (upgrade of an existing program).
set -e
cd "$(dirname "$0")/.."
. scripts/solana-env.sh

RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
case "$RPC" in
*mainnet*) echo "Refusing to deploy: devnet only." >&2; exit 1 ;;
esac
KEYS_DIR="${HUDDLE_KEYS_DIR:-keys}"
TREASURY="$KEYS_DIR/treasury-keypair.json"
SO=target/deploy/huddle_vault.so
DECLARED_ID="$(sed -n 's/^declare_id!("\(.*\)");$/\1/p' programs/huddle_vault/src/lib.rs)"

if [ ! -f "$TREASURY" ]; then
  echo "No treasury keypair at $TREASURY. Run: pnpm tsx scripts/solana-setup.ts" >&2
  exit 1
fi

# Program keypair: the durable copy in the keys dir wins; keep target/deploy in sync for `anchor build`.
if [ -f "$KEYS_DIR/huddle_vault-keypair.json" ]; then
  mkdir -p target/deploy
  cp "$KEYS_DIR/huddle_vault-keypair.json" target/deploy/huddle_vault-keypair.json
fi

if [ "$1" != "--skip-build" ]; then
  anchor build --no-idl
fi
[ -f "$SO" ] || { echo "Missing $SO: build first." >&2; exit 1; }

if [ -f target/deploy/huddle_vault-keypair.json ] &&
  [ "$(solana-keygen pubkey target/deploy/huddle_vault-keypair.json)" = "$DECLARED_ID" ]; then
  PROGRAM_ARG=target/deploy/huddle_vault-keypair.json
else
  # No matching keypair: only an upgrade of the already-deployed program is possible.
  PROGRAM_ARG="$DECLARED_ID"
fi

BALANCE="$(solana balance "$TREASURY" --url "$RPC" | awk '{print $1}')"
NEED="$(solana rent "$(wc -c <"$SO" | tr -d ' ')" --url "$RPC" | awk '/Rent-exempt minimum/ {print $3}')"
echo "Program id:        $DECLARED_ID"
echo "Treasury:          $(solana-keygen pubkey "$TREASURY")  ($BALANCE SOL)"
echo "Program rent:      ~$NEED SOL (plus fees; a first deploy also needs the same again for the temporary buffer)"

mkdir -p target/deploy
solana program deploy "$SO" \
  --program-id "$PROGRAM_ARG" \
  --keypair "$TREASURY" \
  --upgrade-authority "$TREASURY" \
  --url "$RPC" | tee target/deploy/devnet-deploy.out

echo
echo "Put this in .env:   HUDDLE_PROGRAM_ID=$DECLARED_ID"
echo "Explorer:           https://explorer.solana.com/address/$DECLARED_ID?cluster=devnet"
echo "(The 'Signature' line above is the deploy transaction.)"
