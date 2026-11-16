import type { Announcer, LlmClient } from '@huddle/shared';
import { HuddleAnnouncer, type AnnouncerOptions } from './announcer';
import { createLlmClient, type LlmOptions } from './llm';
import type { Env } from './log';

export type { Env, FetchLike, Logger } from './log';
export type { AnnouncerOptions, LineTiming } from './announcer';
export type { LlmOptions } from './llm';

/**
 * LLM client (Anthropic Messages API by default; PRD section 6). `available` is false with no key, and
 * `completeJson` resolves null on timeout, API error or invalid JSON, so callers fall back to templates.
 */
export { createLlmClient };

/**
 * Announcer: LLM lines with template fallback, ElevenLabs streaming TTS with a memory + disk cache,
 * stingers, the offline TALK parser and the ElevenLabs Agents session (PRD section 7). With no
 * `ELEVENLABS_API_KEY` (or on any ElevenLabs error) lines carry no `audioUrl` and clients use Web Speech.
 */
export function createAnnouncer(
  env: Env = process.env,
  llm: LlmClient = createLlmClient(env),
  opts: AnnouncerOptions = {},
): Announcer {
  return new HuddleAnnouncer(env, llm, opts);
}

export { HuddleAnnouncer, LATENCY_TARGET_MS, DEFAULT_TTS_BUDGET_MS } from './announcer';
export { DEFAULT_LLM_MODEL, ANTHROPIC_VERSION, extractFirstJson, latencyParams } from './llm';
export { PERSONAS, PERSONA_IDS, voiceIdFor, type PersonaConfig } from './personas';
export { templateLine, templateVariants, warmupLines, money } from './templates';
export { announcerSystemPrompt, announcerUserPrompt, factsFor, validateLines, safetyViolation, TEMPLATE_ONLY_EVENTS } from './lines';
export { answerTalk, describeOdds, detectIntent, parseAmount, type TalkIntent } from './talk';
export { SFX_NAMES, SFX_PROMPTS, sfxFor, sfxFile, sfxDir } from './sfx';
export { DEFAULT_TTS_MODEL, ELEVENLABS_BASE_URL, TTS_OUTPUT_FORMAT, audioId } from './tts';
export { AGENT_DYNAMIC_VARIABLES, ROOM_PLAYER_NAME, agentIdFor } from './agent';
export { numberToWords, wordsToDigits, speakable } from './numbers';
