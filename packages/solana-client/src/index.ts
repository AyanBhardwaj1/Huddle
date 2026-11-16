import type { SettlementClient, SettlementMode } from '@huddle/shared';
import { MockSettlementClient } from '@huddle/shared/mocks';

export type Env = Record<string, string | undefined>;

/**
 * Settlement client factory (PRD section 8). STUB: always the in-memory mock until workstream A1
 * lands the real huddle_vault client. Keep this signature:
 *  - mode "points": always the mock (no chain calls).
 *  - mode "vault" / "trusted": the real devnet client when SOLANA_RPC_URL, HUDDLE_PROGRAM_ID,
 *    USDC_MINT and TREASURY_SECRET_KEY are set; otherwise the mock with a warning.
 */
export function createSettlementClient(mode: SettlementMode, _env: Env = process.env): SettlementClient {
  return new MockSettlementClient(mode);
}
