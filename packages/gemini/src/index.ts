import type { GeminiClient } from '@huddle/shared';
import { MockGeminiClient } from '@huddle/shared/mocks';

export type Env = Record<string, string | undefined>;

/**
 * Gemini Prediction Markets client (PRD section 11). STUB: returns the offline mock until
 * workstream A3 lands. Keep this signature.
 */
export function createGeminiClient(_env: Env = process.env): GeminiClient {
  return new MockGeminiClient();
}
