import type { Announcer, LlmClient } from '@huddle/shared';
import { MockAnnouncer, MockLlmClient } from '@huddle/shared/mocks';

export type Env = Record<string, string | undefined>;

/**
 * LLM client (Anthropic Messages API by default; PRD section 6). STUB until workstream A6 lands.
 * Keep this signature.
 */
export function createLlmClient(_env: Env = process.env): LlmClient {
  return new MockLlmClient();
}

/**
 * Announcer: LLM lines + ElevenLabs TTS with cache, Web Speech fallback (PRD section 7).
 * STUB until workstream A6 lands. Keep this signature.
 */
export function createAnnouncer(_env: Env = process.env, _llm: LlmClient = createLlmClient(_env)): Announcer {
  return new MockAnnouncer();
}
