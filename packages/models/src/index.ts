import type { LlmClient, QuestionEngine, QuestionRanker } from '@huddle/shared';
import { MockQuestionEngine, TemplateRanker } from '@huddle/shared/mocks';

/**
 * Trigger rules + template catalog + pricing models (PRD section 6). STUB: returns the shared mock
 * until workstream A3 lands. Keep these signatures.
 */
export function createQuestionEngine(): QuestionEngine {
  return new MockQuestionEngine();
}

/** LLM ranking and phrasing with template fallback. */
export function createQuestionRanker(_llm: LlmClient): QuestionRanker {
  return new TemplateRanker();
}
