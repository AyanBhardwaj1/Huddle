import {
  formatPct,
  payoutPerDollar,
  toBase,
  type LlmClient,
  type Market,
  type Outcome,
  type TalkContext,
  type TalkReply,
} from '@huddle/shared';
import { allowedNumbers, countWords, findInventedNumber, safetyViolation } from './lines';
import { wordsToDigits } from './numbers';
import { PERSONAS, isPersona } from './personas';
import { money } from './templates';

/**
 * Offline TALK fallback (DECISIONS D12): a rule-based intent parser over the live `TalkContext`.
 * It answers odds, score and leaderboard questions with numbers taken straight from the context, and
 * turns "put 5 on yes" into a *draft* the player must confirm in the app. It never moves money.
 */

export type TalkIntent = 'bet' | 'odds' | 'leaderboard' | 'score' | 'balance' | 'markets' | 'results' | 'help' | 'greeting' | 'unknown';

const STOPWORDS = new Set(
  (
    'a an the is are was were be been am do does did will would can could should shall may might of on in at to for from by with ' +
    'and or but if then so that this these those it its it\'s i me my we us our you your he she they them his her their ' +
    'what whats which who whos whom how hows when where why odds odd chance chances price prices probability likely ' +
    'put bet bets place stake wager throw drop risk bucks buck dollars dollar usdc points point pts please hey huddle ' +
    'tell give get got gimme want wanna like about right now there here just some any all up down out going gonna think'
  ).split(' '),
);

const YES_WORDS = new Set(['yes', 'yeah', 'yep', 'yup', 'yea']);
const NO_WORDS = new Set(['no', 'nope', 'nah']);

/** Lowercase, spoken numbers to digits, strip punctuation (keeps digits, decimals and $). */
export function normalize(text: string): string {
  return wordsToDigits(text.toLowerCase().replace(/[’‘`]/g, "'"), { convertOne: true })
    .replace(/[^a-z0-9$.'\s-]/g, ' ')
    .replace(/(?<!\d)\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Light stemmer so "scores", "scored", "scoring" and "score" all meet at the same token. */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (/(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  // "hitting" -> "hitt" -> "hit"; "miss" -> "mis" (applied to every word, so both sides agree).
  if (w.length > 2 && w[w.length - 1] === w[w.length - 2] && !/[aeiou]/.test(w[w.length - 1]!)) w = w.slice(0, -1);
  return w;
}

/** Content tokens of a phrase: stemmed, numbers as digits, stopwords removed. */
export function tokens(text: string, keepStopwords = false): string[] {
  return normalize(text)
    .replace(/'s\b/g, '')
    .replace(/[$']/g, '')
    .split(/[\s-]+/)
    .filter((w) => w && (keepStopwords || !STOPWORDS.has(w)))
    .map(stem);
}

function marketTokens(m: Market): Set<string> {
  return new Set(tokens([m.question, m.hook ?? '', ...m.outcomes.map((o) => o.label)].join(' ')));
}

function recency(m: Market): number {
  return Date.parse(m.openedAt ?? m.createdAt) || 0;
}

/** Most relevant first: open before locked, moment markets before game-long, newest first. */
function byDefaultRelevance(a: Market, b: Market): number {
  const state = (m: Market): number => (m.state === 'open' ? 0 : m.state === 'locked' ? 1 : 2);
  return state(a) - state(b) || Number(b.kind === 'moment') - Number(a.kind === 'moment') || recency(b) - recency(a);
}

interface MarketMatch {
  market: Market;
  score: number;
}

/** Score markets by keyword overlap with the utterance; rarer keywords count more. */
export function rankMarkets(text: string, markets: Market[]): MarketMatch[] {
  const words = new Set(tokens(text));
  const sets = markets.map((m) => marketTokens(m));
  const df = new Map<string, number>();
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  return markets
    .map((market, i) => {
      let score = 0;
      for (const w of words) {
        if (sets[i]!.has(w)) score += 1 + 1 / (df.get(w) ?? 1);
      }
      return { market, score };
    })
    .sort((a, b) => b.score - a.score || byDefaultRelevance(a.market, b.market));
}

function teamAliases(o: Outcome, ctx: TalkContext): string[] {
  const out = [o.label, o.id];
  if (o.id === 'home' || o.label === ctx.home) out.push(ctx.home, 'home');
  if (o.id === 'away' || o.label === ctx.away) out.push(ctx.away, 'away');
  if (/^(draw|tie)$/i.test(o.label) || o.id === 'draw') out.push('draw', 'tie');
  if (/^over\b/i.test(o.label)) out.push('over');
  if (/^under\b/i.test(o.label)) out.push('under');
  return out;
}

/** Find the outcome a phrase names in a market. Null when none or ambiguous. */
export function matchOutcome(market: Market, phrase: string, ctx: TalkContext): Outcome | null {
  const raw = normalize(phrase).split(/[\s-]+/); // unstemmed, for yes/no words ("nope")
  const wordSet = new Set(tokens(phrase, true));
  let best: { outcome: Outcome; score: number } | null = null;
  let tie = false;
  for (const o of market.outcomes) {
    let score = 0;
    const idOrLabel = o.label.toLowerCase();
    if ((idOrLabel === 'yes' || o.id === 'yes') && raw.some((w) => YES_WORDS.has(w))) score = 3;
    if ((idOrLabel === 'no' || o.id === 'no') && raw.some((w) => NO_WORDS.has(w))) score = 3;
    for (const alias of teamAliases(o, ctx)) {
      const at = tokens(alias, true);
      if (at.length && at.every((t) => wordSet.has(t))) score = Math.max(score, 2 + at.length);
    }
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { outcome: o, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best.outcome : null;
}

const AMOUNT = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`(dollars?|bucks?|usdc|points?|pts|cents?)`;
const BET_VERB = /\b(put|bet|place|stake|wager|throw|drop|risk|lay)\b/;

/** Amount in whole currency units (dollars or points). Null when the utterance names none. */
export function parseAmount(normalized: string): number | null {
  const t = normalized.replace(/\b(a|an)\s+(dollar|buck|point)\b/g, '1 $2').replace(/\bhalf (a |an )?(dollar|buck|point)\b/g, '0.5 $2');
  const fromMatch = (m: RegExpExecArray | null, unitIdx = 2): number | null => {
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return /^cents?$/.test(m[unitIdx] ?? '') ? n / 100 : n;
  };
  return (
    fromMatch(new RegExp(String.raw`\$\s?${AMOUNT}`).exec(t)) ??
    fromMatch(new RegExp(String.raw`${AMOUNT}\s*${UNIT}\b`).exec(t)) ??
    fromMatch(new RegExp(String.raw`\b${AMOUNT}\s+(?:\w+\s+)?on\b`).exec(t), 99) ??
    fromMatch(new RegExp(String.raw`\b(?:put|bet|place|stake|wager|throw|drop|risk|lay)\s+(?:me\s+)?(?:down\s+)?(?:for\s+)?${AMOUNT}\b`).exec(t), 99) ??
    fromMatch(new RegExp(String.raw`\bfor\s+${AMOUNT}\s*$`).exec(t), 99)
  );
}

export function detectIntent(normalized: string): TalkIntent {
  const t = normalized;
  const hasAmountOn = new RegExp(String.raw`(?:\$\s?\d|\d+(?:\.\d+)?\s*${UNIT}?\s+on\b)`).test(t);
  const asksOdds = /\b(odds?|chances?|probabilit\w*|likely|likelihood|price|prices|paying|pays?|payout|line|percent|percentage)\b/.test(t);
  const question = /^(what|whats|what's|how|who|whos|who's|is|are|will|can|could|does|do|tell)\b/.test(t);
  if (BET_VERB.test(t) && !(asksOdds && question)) return 'bet';
  if (hasAmountOn && !asksOdds) return 'bet';
  if (/\b(i'll take|i will take|i want|i'd like|gimme|give me)\b.*\bon\b/.test(t) && parseAmount(t) !== null) return 'bet';
  if (asksOdds) return 'odds';
  if (/\b(leaderboard|standings?|in the lead|leading|ahead|on top|first place|last place|in front)\b/.test(t)) return 'leaderboard';
  if (/\bwho'?s?( is)? (winning|losing|up|down|crushing|killing)\b/.test(t)) return /\b(game|match)\b/.test(t) ? 'score' : 'leaderboard';
  if (/\b(score|scoreline|clock|time left|how long left|what minute|which quarter|what quarter|who scored)\b/.test(t)) return 'score';
  if (/\b(my balance|how much (do i|have i|money|cash)|what do i have|how am i doing|am i (up|down|winning|losing))\b/.test(t)) return 'balance';
  if (/\b(what'?s? open|whats open|open markets?|what can i bet|anything to bet|any (bets|markets)|what markets|which markets|what are the (bets|markets))\b/.test(t)) return 'markets';
  if (/\b(what happened|last (result|one|market|bet)|who won (the|that) last|recent results?)\b/.test(t)) return 'results';
  if (/\b(help|how does (this|it|huddle) work|what can you do|what can i (say|ask)|rules|who are you)\b/.test(t)) return 'help';
  if (/^(hi|hey|hello|yo|sup|good (evening|morning|afternoon)|testing|test)\b/.test(t)) return 'greeting';
  return 'unknown';
}

function sortedByPrice(m: Market): { outcome: Outcome; prob: number }[] {
  return m.outcomes.map((outcome) => ({ outcome, prob: m.price[outcome.id] ?? m.prior[outcome.id] ?? 0 })).sort((a, b) => b.prob - a.prob);
}

function payoutText(prob: number, ctx: TalkContext): string | null {
  const pay = payoutPerDollar(prob);
  if (pay <= 0) return null;
  return ctx.points ? `1 point pays ${pay.toFixed(2)}` : `$1 pays $${pay.toFixed(2)}`;
}

function sidesText(m: Market): string {
  const sides = sortedByPrice(m).slice(0, 3);
  return sides.map((s) => `${s.outcome.label} at ${formatPct(s.prob)}`).join(sides.length === 2 ? ' or ' : ', ');
}

/** Live odds for one market, straight from `market.price` (plus Gemini when the market has a reference). */
export function describeOdds(m: Market, ctx: TalkContext, focus?: Outcome | null): string {
  const priced = sortedByPrice(m);
  const lead = (focus && priced.find((p) => p.outcome.id === focus.id)) || priced[0];
  if (!lead) return `${m.question} I don't have a price on that yet.`;
  const pay = payoutText(lead.prob, ctx);
  const rest = priced.filter((p) => p.outcome.id !== lead.outcome.id).slice(0, 2);
  const parts: string[] = [m.question.trim().replace(/[.!]$/, '')];
  if (!/[?]$/.test(parts[0]!)) parts[0] += '.';
  const verb = m.state === 'open' ? 'is at' : 'closed at';
  parts.push(`${lead.outcome.label} ${verb} ${formatPct(lead.prob)}${pay && m.state === 'open' ? `, ${pay}` : ''}.`);
  if (rest.length) parts.push(`${rest.map((r) => `${r.outcome.label} ${formatPct(r.prob)}`).join(', ')}.`);
  const gem = m.geminiRef;
  if (gem) {
    const label = gem.label ?? m.outcomes.find((o) => o.id === gem.outcomeId)?.label ?? m.outcomes[0]?.label;
    if (label) parts.push(`Gemini has ${label} at ${formatPct(gem.prob)}.`);
  }
  if (m.state === 'locked') parts.push("That one's locked.");
  return parts.join(' ');
}

function tradable(ctx: TalkContext): Market[] {
  return ctx.markets.filter((m) => m.state === 'open').sort(byDefaultRelevance);
}

function visible(ctx: TalkContext): Market[] {
  return ctx.markets.filter((m) => m.state === 'open' || m.state === 'locked').sort(byDefaultRelevance);
}

function answerOdds(text: string, ctx: TalkContext): TalkReply {
  const pool = visible(ctx);
  if (!pool.length) return { text: "Nothing's open right now. Sit tight, the next one's coming." };
  // Keywords pick the market; naming one of its outcomes ("odds on Portugal") is a further hint.
  let best: { market: Market; focus: Outcome | null; score: number } | null = null;
  for (const r of rankMarkets(text, pool)) {
    const focus = matchOutcome(r.market, text, ctx);
    const named = focus && !/^(yes|no)$/i.test(focus.label) ? 1.5 : 0;
    const score = r.score + named;
    if (!best || score > best.score) best = { market: r.market, focus, score };
  }
  const { market, focus } = best!;
  return { text: describeOdds(market, ctx, focus) };
}

function compareRank(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function answerBet(normalized: string, ctx: TalkContext): TalkReply {
  const open = tradable(ctx);
  if (!open.length) return { text: "Nothing's open to bet on right now. I'll shout when the next one drops." };
  const amount = parseAmount(normalized);
  // What the player wants to back: the words after "on" (minus trailing filler), else the whole utterance.
  const onIdx = normalized.search(/\bon\b/);
  const stake = new RegExp(String.raw`\$?\s?\d+(?:\.\d+)?\s*${UNIT}?`);
  const target = (onIdx >= 0 ? normalized.slice(onIdx + 2) : normalized.replace(stake, ' '))
    .replace(/\b(for me|please|thanks|thank you|right now|mate|buddy)\b/g, ' ')
    .replace(/\bfor \d+(?:\.\d+)?\s*\w*\s*$/, ' ')
    .trim();

  // Strip the stake so "5" is not mistaken for a keyword of some market ("... hits 5 corners").
  const withoutStake = normalized.replace(new RegExp(String.raw`${stake.source}\s+on\b`), ' on ');
  const targetTokens = new Set(tokens(target));
  /**
   * Pick the market that explains the most of what was said after "on". "Portugal reaching seven
   * corners" is the corners market even though "Portugal" is also an outcome of the match winner;
   * a bare "Portugal" is the match winner. Ties go to a named outcome, then keywords, then recency.
   */
  let chosen: { market: Market; outcome: Outcome | null; rank: [number, number, number, number] } | null = null;
  for (const r of rankMarkets(withoutStake, open)) {
    const outcome = matchOutcome(r.market, target, ctx);
    const mt = marketTokens(r.market);
    let explained = 0;
    for (const t of targetTokens) if (mt.has(t)) explained += 1;
    if (outcome) explained = Math.max(explained, 1);
    const named = outcome && !/^(yes|no)$/i.test(outcome.label) ? 1 : 0;
    const rank: [number, number, number, number] = [explained, named, outcome ? 1 : 0, r.score];
    // Strictly better only: on a full tie the earlier (more relevant) market stays.
    if (!chosen || compareRank(rank, chosen.rank) > 0) chosen = { market: r.market, outcome, rank };
  }
  if (!chosen) return { text: "I couldn't find that market. Ask me what's open." };
  const market = chosen.market;
  let outcome = chosen.outcome;
  // "ten on Ronaldo scoring": no side named, but the words point at a yes/no market -> assume Yes.
  if (!outcome && chosen.rank[0] > 0) {
    const yes = market.outcomes.find((o) => o.id === 'yes' || /^yes$/i.test(o.label));
    const no = market.outcomes.find((o) => o.id === 'no' || /^no$/i.test(o.label));
    const negated = /\b(not|won't|wont|doesn't|doesnt|never|miss|misses|against|fail|fails)\b/.test(target);
    if (yes && no) outcome = negated ? no : yes;
  }
  if (!outcome) return { text: `Which side? ${market.question} It's ${sidesText(market)}.` };
  if (amount === null) return { text: `How much on ${outcome.label}? Say something like "five on ${outcome.label}".` };
  if (!(amount > 0)) return { text: 'That needs to be more than zero. Try "five on yes".' };
  let base: number;
  try {
    base = toBase(amount);
  } catch {
    return { text: "I didn't catch the amount. Try \"five on yes\"." };
  }
  if (base <= 0) return { text: 'That amount is too small. Try a bigger number.' };
  if (ctx.speaker && base > ctx.speaker.balance) {
    return { text: `You've only got ${money(ctx.speaker.balance, ctx)} available${ctx.speaker.name ? `, ${ctx.speaker.name}` : ''}. Try a smaller number.` };
  }
  const prob = market.price[outcome.id] ?? market.prior[outcome.id] ?? 0;
  const who = ctx.speaker?.name ? `, ${ctx.speaker.name}` : '';
  return {
    text: `Drafted ${money(base, ctx)} on ${outcome.label}${prob > 0 ? ` at ${formatPct(prob)}` : ''}: ${market.question} Confirm it in the app${who}.`,
    draft: { marketId: market.id, outcome: outcome.id, amount: base },
  };
}

function standing(pnl: number, ctx: TalkContext): string {
  return pnl > 0 ? `up ${money(pnl, ctx)}` : pnl < 0 ? `down ${money(pnl, ctx)}` : 'even';
}

function answerLeaderboard(normalized: string, ctx: TalkContext): TalkReply {
  const board = [...ctx.leaderboard].sort((a, b) => b.pnl - a.pnl);
  if (!board.length) return { text: 'Nobody is on the board yet. Get a bet in.' };
  if (/\b(losing|last place|bottom|down)\b/.test(normalized) && board.length > 1) {
    const last = board[board.length - 1]!;
    return { text: `${last.name} is bringing up the rear, ${standing(last.pnl, ctx)}. ${board[0]!.name} leads, ${standing(board[0]!.pnl, ctx)}.` };
  }
  const first = board[0]!;
  const parts = [`${first.name} leads, ${standing(first.pnl, ctx)}.`];
  const next = board.slice(1, 3);
  if (next.length) parts.push(`Then ${next.map((r) => `${r.name}, ${standing(r.pnl, ctx)}`).join('; ')}.`);
  if (first.streak && first.streak >= 3) parts.push(`${first.name} has won ${first.streak} in a row.`);
  return { text: parts.join(' ') };
}

function answerScore(ctx: TalkContext): TalkReply {
  if (!ctx.score) return { text: "I don't have a score yet. The game hasn't started." };
  return { text: `It's ${ctx.score}${ctx.clock ? `, ${ctx.clock} on the clock` : ''}.` };
}

function answerBalance(ctx: TalkContext): TalkReply {
  const sp = ctx.speaker;
  if (!sp) return { text: 'I can only see your balance from your own phone. Tap the mic in the app and ask again.' };
  const row = ctx.leaderboard.find((r) => r.name === sp.name);
  return { text: `${sp.name}, you have ${money(sp.balance, ctx)} available${row ? ` and you're ${standing(row.pnl, ctx)} tonight` : ''}.` };
}

function answerMarkets(ctx: TalkContext): TalkReply {
  const open = tradable(ctx);
  if (!open.length) return { text: "Nothing's open right now. Sit tight, the next one's coming." };
  const top = open.slice(0, 3).map((m) => {
    const lead = sortedByPrice(m)[0];
    return `${m.question}${lead ? ` ${lead.outcome.label} at ${formatPct(lead.prob)}.` : ''}`;
  });
  const count = open.length === 1 ? 'One market is open.' : `${open.length} markets are open.`;
  return { text: `${count} ${top.join(' ')}` };
}

function answerResults(ctx: TalkContext): TalkReply {
  const last = ctx.recentResults[0];
  if (!last) return { text: 'Nothing has been settled yet.' };
  return { text: `Last one: ${last.question} It was ${last.outcome}.` };
}

const HELP = 'Ask me the odds, the score or who\'s winning, or say something like "five on yes" and I\'ll draft the bet for you to confirm in the app.';

/** Rule-based answer. Pure: same input, same output. */
export function answerTalk(text: string, ctx: TalkContext): TalkReply & { intent: TalkIntent } {
  const normalized = normalize(text ?? '');
  if (!normalized) return { intent: 'unknown', text: `I didn't catch that. ${HELP}` };
  const intent = detectIntent(normalized);
  switch (intent) {
    case 'bet':
      return { intent, ...answerBet(normalized, ctx) };
    case 'odds':
      return { intent, ...answerOdds(text, ctx) };
    case 'leaderboard':
      return { intent, ...answerLeaderboard(normalized, ctx) };
    case 'score':
      return { intent, ...answerScore(ctx) };
    case 'balance':
      return { intent, ...answerBalance(ctx) };
    case 'markets':
      return { intent, ...answerMarkets(ctx) };
    case 'results':
      return { intent, ...answerResults(ctx) };
    case 'help':
      return { intent, text: `I'm your Huddle announcer. ${HELP}` };
    case 'greeting':
      return { intent, text: `Hey${ctx.speaker?.name ? `, ${ctx.speaker.name}` : ''}! ${HELP}` };
    case 'unknown': {
      // A bare mention of a market ("Ronaldo penalty?") is most useful answered with its odds.
      const pool = visible(ctx);
      const best = rankMarkets(text, pool)[0];
      if (best && best.score >= 2) return { intent: 'odds', text: describeOdds(best.market, ctx, matchOutcome(best.market, text, ctx)) };
      return { intent, text: `Not sure about that one. ${HELP}` };
    }
  }
}

/**
 * Optional LLM pass: rephrase the rule-based reply in the persona's voice. Phrasing only: the draft is
 * never touched, and the rewrite is rejected if it changes, adds or drops any number.
 */
export async function rephraseReply(
  llm: LlmClient,
  reply: string,
  ctx: TalkContext,
  timeoutMs = 1200,
): Promise<string | null> {
  if (!llm.available) return null;
  const persona = PERSONAS[isPersona(ctx.persona) ? ctx.persona : 'soccer'];
  const raw = await llm.completeJson({
    system: [
      'You are the voice of Huddle, a watch-party prediction game. Rephrase the ANSWER so it sounds like the persona speaking out loud.',
      `Persona: ${persona.style}`,
      'Rules: keep every number, name, team and outcome exactly as written, in digits; do not add or remove facts; at most 2 sentences and 40 words;',
      'never encourage chasing losses or betting more; never imitate a real commentator or celebrity; no profanity.',
      'If the ANSWER tells the player to confirm in the app, keep that instruction. Reply with ONLY JSON: {"text": string}.',
    ].join('\n'),
    user: `ANSWER: ${reply}`,
    maxTokens: 160,
    timeoutMs,
  });
  const out = raw !== null && typeof raw === 'object' ? (raw as { text?: unknown }).text : undefined;
  if (typeof out !== 'string') return null;
  const text = out.replace(/\s+/g, ' ').trim();
  if (!text || countWords(text) > 45 || safetyViolation(text)) return null;
  const allowed = allowedNumbers(reply);
  if (findInventedNumber(text, allowed) !== null) return null;
  // Every number in the original must survive the rewrite.
  const kept = allowedNumbers(text);
  for (const n of allowed) if (!kept.has(n)) return null;
  if (/confirm/i.test(reply) && !/confirm/i.test(text)) return null;
  return text;
}
