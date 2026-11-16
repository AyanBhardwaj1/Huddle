import type { LlmClient, QuestionEngine, QuestionRanker } from '@huddle/shared';
import { HuddleQuestionEngine } from './engine';
import { LlmQuestionRanker } from './ranker';

/**
 * Trigger rules + template catalog + pricing models + resolvers (PRD section 6).
 * Prices come from JSON tables/coefficients in `packages/models/models/*.json` (built by `ml/`),
 * evaluated in TypeScript. The LLM never sets a price.
 */
export function createQuestionEngine(): QuestionEngine {
  return new HuddleQuestionEngine();
}

/** LLM ranking and phrasing with template fallback (1.5 s timeout, zod-validated). */
export function createQuestionRanker(llm: LlmClient): QuestionRanker {
  return new LlmQuestionRanker(llm);
}

export { HuddleQuestionEngine, TEMPLATES } from './engine';
export {
  LlmQuestionRanker,
  QUESTION_RANKER_SYSTEM,
  buildRankerUserPrompt,
  templatePicks,
  textIsAcceptable,
  allowedNumbers,
  RANKER_TIMEOUT_MS,
  MAX_QUESTION_CHARS,
  MAX_HOOK_WORDS,
} from './ranker';
export * from './math';
export * as soccerModel from './soccer';
export * as nflModel from './nfl';
