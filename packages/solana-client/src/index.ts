import { parseSecretKey, type SettlementClient, type SettlementMode } from '@huddle/shared';
import { MockSettlementClient } from '@huddle/shared/mocks';
import { VaultSettlementClient } from './client';

export * from './accounts';
export * from './client';
export * from './decode';
export * from './errors';
export * from './instructions';
export * from './pda';

export type Env = Record<string, string | undefined>;

/** Everything the real client needs. Missing any of these -> the mock, with one warning. */
export const REQUIRED_ENV = ['SOLANA_RPC_URL', 'HUDDLE_PROGRAM_ID', 'USDC_MINT', 'TREASURY_SECRET_KEY'] as const;

let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[solana-client] ${message}`);
}

/** Test hook: allow the "falling back to the mock" warning to be logged again. */
export function resetSettlementWarning(): void {
  warned = false;
}

/**
 * Settlement client factory (PRD section 8).
 *  - mode "points": always the in-memory mock (no chain calls).
 *  - mode "vault" / "trusted": the real devnet client when SOLANA_RPC_URL, HUDDLE_PROGRAM_ID, USDC_MINT
 *    and TREASURY_SECRET_KEY are set; otherwise the mock, with one warning, so the demo never blocks.
 *
 * Optional: SOLANA_CLUSTER (default "devnet"; "localnet" for a local validator), SOLANA_WS_URL.
 */
export function createSettlementClient(mode: SettlementMode, env: Env = process.env): SettlementClient {
  if (mode === 'points') return new MockSettlementClient('points');

  const missing = REQUIRED_ENV.filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    warnOnce(`${missing.join(', ')} not set: using the offline mock vault for "${mode}" settlement (no on-chain calls).`);
    return new MockSettlementClient(mode);
  }
  let treasurySecretKey: Uint8Array;
  try {
    treasurySecretKey = parseSecretKey(env.TREASURY_SECRET_KEY as string);
  } catch {
    // Fixed text on purpose: a parser error message can quote part of the secret.
    warnOnce('TREASURY_SECRET_KEY is not a valid secret key: using the offline mock vault.');
    return new MockSettlementClient(mode);
  }
  try {
    return new VaultSettlementClient({
      mode,
      rpcUrl: (env.SOLANA_RPC_URL as string).trim(),
      wsUrl: env.SOLANA_WS_URL?.trim() || undefined,
      programId: (env.HUDDLE_PROGRAM_ID as string).trim(),
      usdcMint: (env.USDC_MINT as string).trim(),
      treasurySecretKey,
      cluster: env.SOLANA_CLUSTER?.trim() || 'devnet',
    });
  } catch (e) {
    warnOnce(`could not start the Solana client (${e instanceof Error ? e.message : 'bad configuration'}): using the offline mock vault.`);
    return new MockSettlementClient(mode);
  }
}
