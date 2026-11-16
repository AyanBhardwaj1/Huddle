import type { SportsAdapter } from '@huddle/shared';
import { MockSportsAdapter } from '@huddle/shared/mocks';

export type Env = Record<string, string | undefined>;

/**
 * Sports data adapter factory (PRD section 11). STUB: returns the shared mock until the real
 * Replay / ESPN / API-Football adapters land (workstream A3). Keep this signature.
 */
export function createSportsAdapter(_env: Env = process.env): SportsAdapter {
  return new MockSportsAdapter();
}
