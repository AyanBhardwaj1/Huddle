import type { LlmClient, MarketCandidate, QuestionRanker, RankedPick, RoomContext } from '@huddle/shared';
import { z } from 'zod';

export const RANKER_TIMEOUT_MS = 1500;
export const MAX_QUESTION_CHARS = 80;
export const MAX_HOOK_WORDS = 25;

const PickSchema = z.object({
  index: z.number().int().nonnegative(),
  question: z.string().min(1).max(200),
  hook: z.string().min(1).max(400),
});
const OutputSchema = z.object({ picks: z.array(PickSchema).min(1).max(8) });

/** System prompt for `question_ranker` (PRD section 6). The hard rules are also enforced in code below. */
export const QUESTION_RANKER_SYSTEM = [
  'You are the question editor for Huddle, a watch-party prediction game played by friends in one room.',
  'You are given candidate questions that a deterministic rules engine has already written and priced.',
  'Pick the best ones for this exact moment and rephrase them so they are punchy and fun to read aloud.',
  '',
  'HARD RULES (never break these):',
  '1. Never invent or change numbers. Every number you write (odds, percentages, minutes, downs, distances, lines, scores) must be copied exactly from the candidate you picked. If in doubt, leave the number out.',
  '2. Never change what the question asks, its outcomes, the team or the player. Only the wording may change.',
  '3. No slurs, no harassment, nothing about anyone\'s body, identity, family or money troubles. Light teasing only, and only about the game.',
  '4. Never encourage anyone to chase losses, bet more, or win money back. No "double or nothing", no "you are due".',
  '5. Do not mention real money, sportsbooks or betting advice.',
  '',
  'STYLE: question at most 80 characters and it must end with a question mark. Hook: one spoken line, at most 25 words, present tense, no emojis, no hashtags.',
  'Prefer the candidate with the highest priority unless the room context makes another one clearly more fun. Do not pick two candidates that ask nearly the same thing.',
  '',
  'OUTPUT: JSON only, no prose, exactly this shape:',
  '{"picks":[{"index":0,"question":"...","hook":"..."}]}',
  '"index" is the candidate\'s index in the list you were given. Return at most the number of picks requested, best first.',
].join('\n');

export function buildRankerUserPrompt(candidates: MarketCandidate[], ctx: RoomContext, maxPicks: number): string {
  const payload = {
    maxPicks,
    room: {
      party: ctx.partyName,
      sport: ctx.sport,
      match: `${ctx.home} vs ${ctx.away}`,
      score: ctx.score,
      clock: ctx.clock,
      playingForPoints: ctx.points,
      leaderboard: ctx.leaderboard.slice(0, 5).map((l) => ({ name: l.name, streak: l.streak ?? 0 })),
      recentResults: ctx.recentResults.slice(-3),
    },
    candidates: candidates.map((c, index) => ({
      index,
      kind: c.kind,
      priority: c.priority,
      question: c.question,
      hook: c.hook,
      outcomes: c.outcomes.map((o) => ({ label: o.label, modelPercent: Math.round((c.prior[o.id] ?? 0) * 100) })),
    })),
  };
  return `Pick up to ${maxPicks} and phrase them. Input:\n${JSON.stringify(payload)}`;
}

/** Highest priority first, template text. Stable for equal priorities. */
export function templatePicks(candidates: MarketCandidate[], maxPicks: number): RankedPick[] {
  return candidates
    .map((c, index) => ({ c, index }))
    .sort((a, b) => b.c.priority - a.c.priority || a.index - b.index)
    .slice(0, Math.max(0, maxPicks))
    .map(({ c, index }) => ({ index, question: c.question, hook: c.hook }));
}

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

/** Every number the LLM may repeat for a candidate: those in the template text, plus the model percentages. */
export function allowedNumbers(c: MarketCandidate): Set<string> {
  const set = new Set<string>([...numbersIn(c.question), ...numbersIn(c.hook), ...c.outcomes.flatMap((o) => numbersIn(o.label))]);
  for (const o of c.outcomes) set.add(String(Math.round((c.prior[o.id] ?? 0) * 100)));
  return set;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const CHASE = /\b(double or nothing|win it back|win (?:it|your money) back|chase|you(?:'| a)re due|all in|bet more|bet bigger)\b/i;

/** Is this LLM text safe to show for the candidate? (length, invented numbers, loss chasing) */
export function textIsAcceptable(text: string, c: MarketCandidate, kind: 'question' | 'hook'): boolean {
  const t = text.trim();
  if (!t) return false;
  if (kind === 'question' && t.length > MAX_QUESTION_CHARS) return false;
  if (kind === 'hook' && wordCount(t) > MAX_HOOK_WORDS) return false;
  if (CHASE.test(t)) return false;
  const allowed = allowedNumbers(c);
  return numbersIn(t).every((n) => allowed.has(n));
}

/**
 * LLM ranking and phrasing with a template fallback (PRD section 6, step 4).
 * Falls back to template text, highest priority first, when the LLM is unavailable, slow (1.5 s),
 * returns invalid JSON, or breaks a hard rule. Individual texts that fail a check fall back alone.
 */
export class LlmQuestionRanker implements QuestionRanker {
  constructor(
    private readonly llm: LlmClient,
    private readonly timeoutMs: number = RANKER_TIMEOUT_MS,
  ) {}

  async rank(candidates: MarketCandidate[], ctx: RoomContext, maxPicks: number): Promise<RankedPick[]> {
    const limit = Math.max(0, Math.min(maxPicks, candidates.length));
    const fallback = templatePicks(candidates, limit);
    if (limit === 0 || !this.llm.available) return fallback;

    let raw: unknown = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), this.timeoutMs);
      });
      const call = this.llm
        .completeJson({ system: QUESTION_RANKER_SYSTEM, user: buildRankerUserPrompt(candidates, ctx, limit), maxTokens: 400, timeoutMs: this.timeoutMs })
        .catch(() => null);
      raw = await Promise.race([call, timeout]);
    } catch {
      raw = null;
    } finally {
      if (timer) clearTimeout(timer);
    }

    const parsed = OutputSchema.safeParse(raw);
    if (!parsed.success) return fallback;

    const picks: RankedPick[] = [];
    const seen = new Set<number>();
    for (const p of parsed.data.picks) {
      if (picks.length >= limit) break;
      const c = candidates[p.index];
      if (!c || seen.has(p.index)) continue;
      seen.add(p.index);
      picks.push({
        index: p.index,
        question: textIsAcceptable(p.question, c, 'question') ? p.question.trim() : c.question,
        hook: textIsAcceptable(p.hook, c, 'hook') ? p.hook.trim() : c.hook,
      });
    }
    return picks.length > 0 ? picks : fallback;
  }
}
