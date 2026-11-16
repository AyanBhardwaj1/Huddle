// Idempotent devnet setup for the Huddle vault: treasury + box-signer keypairs, devnet SOL, test USDC
// mint, and the .env lines. Run from the repo root:
//
//   pnpm tsx scripts/solana-setup.ts
//
// The implementation lives in packages/solana-client/scripts/setup.ts (so it can resolve the Solana
// packages, which are dependencies of @huddle/solana-client, not of the repo root). DEVNET ONLY.
import '../packages/solana-client/scripts/setup.ts';
