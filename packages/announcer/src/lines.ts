import {
  formatPayout,
  formatPct,
  type AnnouncerEvent,
  type AnnouncerEventType,
  type LlmClient,
  type Market,
  type RoomContext,
} from '@huddle/shared';
import { extractNumbers, spokenNumbers } from './numbers';
import { PERSONAS, isPersona } from './personas';
import { money, topOutcome } from './templates';

/**
 * The `announcer_lines` prompt (PRD section 6): event + room context -> JSON `{ lines: string[] }`,
 * plus the validator that decides whether the LLM's answer may be spoken. Anything that fails goes
 * back to the template line, so the announcer never says an invented number.
 */

export const MAX_WORDS_PER_LINE = 25;
export const LLM_LINES_TIMEOUT_MS = 1500;

/** Events that must never wait for an LLM: they are time-critical or already have their text. */
export const TEMPLATE_ONLY_EVENTS: ReadonlySet<AnnouncerEventType> = new Set(['lock_soon', 'market_locked', 'talk_reply']);

export function maxLinesFor(type: AnnouncerEventType): number {
  return type === 'game_recap' ? 3 : 2;
}

export function announcerSystemPrompt(ctx: RoomContext): string {
  const persona = PERSONAS[isPersona(ctx.persona) ? ctx.persona : 'soccer'];
  return [
    'You are the live announcer for Huddle, a watch-party prediction game friends play together for test money or points.',
    'You write exactly what the announcer says out loud on the speaker when something happens.',
    '',
    `Persona: ${persona.style}`,
    '',
    'Output format: reply with ONLY a JSON object {"lines": string[]}. 1 to 2 lines (up to 3 for a game_recap).',
    `Each line is at most ${MAX_WORDS_PER_LINE} words of plain spoken English. No emojis, no markdown, no stage directions, no hashtags.`,
    '',
    'Hard rules:',
    '1. Never invent numbers. Every number you say (odds, percentages, payouts, amounts, seconds, scores, minutes, counts) must be copied exactly from FACTS or ROOM, written in digits the same way it is given ("77%", "$8", "20 seconds"). If you do not have a number, do not say one.',
    '2. Only name people, teams and outcomes that appear in FACTS or ROOM. Include everything listed in MUST_MENTION.',
    '3. No slurs, no profanity, no harassment, nothing about who a person is. Light, friendly roasting of a bet is fine; keep it playful and never personal.',
    '4. Never encourage anyone to chase losses, to bet more to win money back, or to bet beyond their means. Never promise or imply a sure win.',
    '5. Use your own original voice. Never imitate, quote or name a real commentator, broadcaster or celebrity, and never use their catchphrases.',
    '6. Say the thing that matters first: what happened, then the number, then the call to action if there is one.',
  ].join('\n');
}

function outcomesWithPrices(m: Market): { label: string; room: string }[] {
  return m.outcomes.map((o) => ({ label: o.label, room: formatPct(m.price[o.id] ?? m.prior[o.id] ?? 0) }));
}

export interface LineFacts {
  facts: Record<string, unknown>;
  /** Strings the line must contain (case-insensitive), so the LLM cannot drop the news itself. */
  mustMention: string[];
}

/** Everything the LLM may say about an event. All amounts are pre-formatted; it only copies them. */
export function factsFor(event: AnnouncerEvent, ctx: RoomContext): LineFacts {
  switch (event.type) {
    case 'market_opened': {
      const m = event.market;
      const top = topOutcome(m);
      const gem = m.geminiRef;
      const gemLabel = gem ? (gem.label ?? m.outcomes.find((o) => o.id === gem.outcomeId)?.label ?? m.outcomes[0]?.label) : undefined;
      return {
        facts: {
          question: m.question,
          hook: m.hook,
          outcomes: outcomesWithPrices(m),
          favorite: top ? { label: top.outcome.label, room: formatPct(top.prob), payout: ctx.points ? undefined : formatPayout(top.prob) } : undefined,
          seconds_until_lock: event.lockInSecs ? `${Math.round(event.lockInSecs)} seconds` : undefined,
          gemini: gem && gemLabel ? { label: gemLabel, price: formatPct(gem.prob) } : undefined,
        },
        mustMention: top ? [formatPct(top.prob)] : [],
      };
    }
    case 'lock_soon':
      return { facts: { seconds_left: `${event.secondsLeft} seconds` }, mustMention: [] };
    case 'market_locked':
      return { facts: { question: event.market.question }, mustMention: [] };
    case 'big_trade':
      return {
        facts: {
          player: event.fill.playerName,
          action: event.fill.kind === 'amm_sell' ? 'cashed out' : event.fill.kind === 'offer_posted' ? 'offered a bet' : 'bet',
          amount: money(event.fill.amount, ctx),
          outcome: event.outcomeLabel,
          question: event.market.question,
          price_after: event.fill.price !== undefined ? formatPct(event.fill.price) : undefined,
        },
        mustMention: [event.fill.playerName, money(event.fill.amount, ctx)],
      };
    case 'market_resolved': {
      const atLock = event.market.outcome ? event.market.roomProbAtLock?.[event.market.outcome] : undefined;
      return {
        facts: {
          question: event.market.question,
          result: event.outcomeLabel,
          room_had_result_at: atLock !== undefined ? formatPct(atLock) : undefined,
          winners: [...event.winners].sort((a, b) => b.amount - a.amount).slice(0, 3).map((w) => ({ name: w.name, won: money(w.amount, ctx) })),
          losers: [...event.losers].sort((a, b) => b.amount - a.amount).slice(0, 3).map((l) => ({ name: l.name, lost: money(l.amount, ctx) })),
        },
        mustMention: [event.outcomeLabel],
      };
    }
    case 'market_voided':
      return { facts: { question: event.market.question, reason: event.reason, refund: 'every stake is returned' }, mustMention: [] };
    case 'player_joined':
      return {
        facts: { name: event.name, buy_in: event.amount > 0 ? money(event.amount, ctx) : undefined, remote: event.remote, city: event.city },
        mustMention: [event.name],
      };
    case 'leaderboard_change':
      return {
        facts: { new_leader: event.leader, standing: event.pnl > 0 ? `up ${money(event.pnl, ctx)}` : event.pnl < 0 ? `down ${money(event.pnl, ctx)}` : 'even' },
        mustMention: [event.leader],
      };
    case 'game_recap':
      return {
        facts: {
          final_score: event.finalScore,
          leaderboard: event.leaderboard.slice(0, 3).map((r) => ({ name: r.name, result: r.pnl >= 0 ? `up ${money(r.pnl, ctx)}` : `down ${money(r.pnl, ctx)}` })),
          biggest_swing: event.biggestSwing
            ? { name: event.biggestSwing.name, amount: money(event.biggestSwing.amount, ctx), question: event.biggestSwing.question }
            : undefined,
          friends_vs_model_vs_gemini_verdict: event.scorecard.verdict,
        },
        mustMention: event.leaderboard[0] ? [event.leaderboard[0].name] : [],
      };
    case 'talk_reply':
      return { facts: { text: event.text }, mustMention: [] };
  }
}

function roomFacts(ctx: RoomContext): Record<string, unknown> {
  return {
    party: ctx.partyName,
    sport: ctx.sport,
    teams: { home: ctx.home, away: ctx.away },
    score: ctx.score,
    clock: ctx.clock,
    currency: ctx.points ? 'points (no money)' : 'test dollars',
    leaderboard: ctx.leaderboard.slice(0, 3).map((r) => ({
      name: r.name,
      result: r.pnl >= 0 ? `up ${money(r.pnl, ctx)}` : `down ${money(r.pnl, ctx)}`,
      streak: r.streak,
    })),
    recent_results: ctx.recentResults.slice(0, 3),
  };
}

export function announcerUserPrompt(event: AnnouncerEvent, ctx: RoomContext): { user: string; facts: LineFacts; room: Record<string, unknown> } {
  const facts = factsFor(event, ctx);
  const room = roomFacts(ctx);
  const user = [
    `EVENT: ${event.type}`,
    `FACTS: ${JSON.stringify(facts.facts)}`,
    `ROOM: ${JSON.stringify(room)}`,
    `MUST_MENTION: ${JSON.stringify(facts.mustMention)}`,
    `Write the announcer's ${maxLinesFor(event.type) === 3 ? '2 to 3' : '1 to 2'} lines as JSON {"lines": [...]}.`,
  ].join('\n');
  return { user, facts, room };
}

// ───────────────────────── validation ─────────────────────────

/** Encouraging players to chase losses or promising wins (PRD section 13 guardrail). */
const CHASE_PATTERNS: RegExp[] = [
  /\bwin (?:it|that|them|your money|everything) (?:all )?back\b/i,
  /\b(?:get|make|earn) (?:it|that|your money) (?:all )?back\b/i,
  /\bchas(?:e|ing)\b/i,
  /\bdouble (?:down|up|or nothing)\b/i,
  /\ball[- ]in\b/i,
  /\byou(?:'re| are) due\b/i,
  /\bcan(?:'t|not) lose\b/i,
  /\b(?:sure|safe) (?:thing|bet)\b/i,
  /\bguarantee(?:d|s)?\b/i,
  /\b(?:easy|free) money\b/i,
  /\bbet (?:more|bigger|again|the house|it all)\b/i,
  /\b(?:borrow|loan|rent money|savings|paycheck)\b/i,
  /\bone more bet\b/i,
  /\brecoup\b/i,
];

/** Harassment and profanity. Roasting a bet is fine ("you're cooked"); attacking a person is not. */
const ABUSE_PATTERNS: RegExp[] = [
  /\b(?:idiot|moron|stupid|dumbass|dumb|loser|pathetic|worthless|ugly|fat|retard(?:ed)?|trash|garbage human)\b/i,
  /\b(?:fuck\w*|shit\w*|bitch\w*|asshole|bastard|dick|piss\w*|crap|damn|slut|whore)\b/i,
  /\b(?:kill|die|hate) (?:you|your|him|her|them)\b/i,
  /\bshut up\b/i,
];

/** Real broadcasters and signature catchphrases the announcer must never borrow. */
const IMITATION_PATTERNS: RegExp[] = [
  /\b(?:martin tyler|peter drury|ray hudson|andr[eé]s cantor|ian darke|gary neville|jim nantz|al michaels|joe buck|tony romo|troy aikman|john madden|kevin harlan|gus johnson|chris berman|stephen a\.? smith|pat mcafee|cris collinsworth|mike tirico)\b/i,
  /\bas .{1,30} would say\b/i,
  /\bgo{4,}l\b/i,
  /\bboom goes the dynamite\b/i,
  /\bhello,? friends\b/i,
  /\bdo you believe in miracles\b/i,
];

export type LineRejection =
  | 'not_json_lines'
  | 'line_count'
  | 'too_long'
  | 'empty'
  | 'invented_number'
  | 'missing_fact'
  | 'chase_losses'
  | 'abuse'
  | 'imitation'
  | 'formatting';

export function safetyViolation(text: string): LineRejection | null {
  if (CHASE_PATTERNS.some((r) => r.test(text))) return 'chase_losses';
  if (ABUSE_PATTERNS.some((r) => r.test(text))) return 'abuse';
  if (IMITATION_PATTERNS.some((r) => r.test(text))) return 'imitation';
  return null;
}

export function countWords(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).length;
}

/** All numbers the announcer is allowed to say: every figure present anywhere in the facts. */
export function allowedNumbers(...sources: unknown[]): Set<number> {
  const set = new Set<number>();
  for (const src of sources) {
    for (const n of spokenNumbers(typeof src === 'string' ? src : JSON.stringify(src ?? ''))) set.add(n);
  }
  return set;
}

export function findInventedNumber(text: string, allowed: Set<number>): number | null {
  const digits = extractNumbers(text);
  for (const n of [...digits, ...spokenNumbers(text)]) {
    if (!allowed.has(n)) return n;
  }
  return null;
}

export type ValidatedLines = { ok: true; lines: string[] } | { ok: false; reason: LineRejection; detail?: string };

/** Decide whether an LLM reply may be spoken. */
export function validateLines(raw: unknown, type: AnnouncerEventType, facts: LineFacts, room: unknown): ValidatedLines {
  const arr = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { lines?: unknown }).lines : undefined;
  if (!Array.isArray(arr) || !arr.every((l): l is string => typeof l === 'string')) return { ok: false, reason: 'not_json_lines' };
  const lines = arr.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!lines.length) return { ok: false, reason: 'empty' };
  if (lines.length > maxLinesFor(type)) return { ok: false, reason: 'line_count', detail: String(lines.length) };
  const long = lines.find((l) => countWords(l) > MAX_WORDS_PER_LINE);
  if (long) return { ok: false, reason: 'too_long', detail: long };
  const text = lines.join(' ');
  if (/[*_#`<>{}[\]]|\p{Extended_Pictographic}/u.test(text)) return { ok: false, reason: 'formatting' };
  const invented = findInventedNumber(text, allowedNumbers(facts.facts, room));
  if (invented !== null) return { ok: false, reason: 'invented_number', detail: String(invented) };
  const lower = text.toLowerCase();
  const missing = facts.mustMention.find((m) => m && !lower.includes(m.toLowerCase()));
  if (missing) return { ok: false, reason: 'missing_fact', detail: missing };
  const unsafe = safetyViolation(text);
  if (unsafe) return { ok: false, reason: unsafe };
  return { ok: true, lines };
}

export interface LlmLineResult {
  text: string | null;
  ms: number;
  rejection?: LineRejection | 'no_reply';
}

/** Ask the LLM for the line. `text` is null whenever the caller must use the template instead. */
export async function llmLine(
  llm: LlmClient,
  event: AnnouncerEvent,
  ctx: RoomContext,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<LlmLineResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const { user, facts, room } = announcerUserPrompt(event, ctx);
  const raw = await llm.completeJson({
    system: announcerSystemPrompt(ctx),
    user,
    maxTokens: 220,
    timeoutMs: opts.timeoutMs ?? LLM_LINES_TIMEOUT_MS,
  });
  const ms = now() - started;
  if (raw === null || raw === undefined) return { text: null, ms, rejection: 'no_reply' };
  const v = validateLines(raw, event.type, facts, room);
  if (!v.ok) return { text: null, ms, rejection: v.reason };
  return { text: v.lines.join(' '), ms };
}
