import {
  formatPayout,
  formatPct,
  formatUsd,
  type AnnouncerEvent,
  type Market,
  type Outcome,
  type Persona,
  type RoomContext,
} from '@huddle/shared';
import { capitalize, numberToWords } from './numbers';
import { isPersona } from './personas';

/**
 * Template lines: the announcer's voice when there is no LLM, when it is slow, or when its output fails
 * validation. Several variants per event per persona; the variant is picked deterministically from a
 * seed so tests (and replays) are stable. No number is ever invented: every figure comes from the event.
 */

/** "$8" / "$14.20" / "8 pts". Always goes through `formatUsd`; whole amounts drop the ".00" for speech. */
export function money(base: number, ctx: Pick<RoomContext, 'points'>): string {
  return formatUsd(Math.abs(base), { points: ctx.points }).replace(/\.00(?=$|\s)/, '');
}

export function topOutcome(m: Market): { outcome: Outcome; prob: number } | null {
  let best: { outcome: Outcome; prob: number } | null = null;
  for (const o of m.outcomes) {
    const prob = m.price[o.id] ?? m.prior[o.id] ?? 0;
    if (!best || prob > best.prob) best = { outcome: o, prob };
  }
  return best;
}

export function endSentence(s: string): string {
  const t = s.trim();
  return /[.!?]["')\]]?$/.test(t) ? t : `${t}.`;
}

/** FNV-1a, 32 bit. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick<T>(items: readonly T[], seed: string): T | undefined {
  return items.length ? items[hashSeed(seed) % items.length] : undefined;
}

/** A stable seed for an event: same event -> same variant. */
export function eventSeed(event: AnnouncerEvent, ctx: RoomContext): string {
  const parts: (string | number)[] = [ctx.partyName, event.type];
  switch (event.type) {
    case 'market_opened':
    case 'market_locked':
    case 'market_voided':
      parts.push(event.market.id);
      break;
    case 'lock_soon':
      parts.push(event.market.id, event.secondsLeft);
      break;
    case 'big_trade':
      parts.push(event.market.id, event.fill.id);
      break;
    case 'market_resolved':
      parts.push(event.market.id, event.outcomeLabel);
      break;
    case 'player_joined':
      parts.push(event.name);
      break;
    case 'leaderboard_change':
      parts.push(event.leader, event.pnl);
      break;
    case 'game_recap':
      parts.push(event.finalScore);
      break;
    case 'talk_reply':
      parts.push(event.text);
      break;
  }
  return parts.join('|');
}

type ByPersona<T> = Record<Persona, T>;

function seconds(n: number): { S: string; s: string; unit: string } {
  const whole = Math.max(0, Math.round(n));
  const words = numberToWords(whole);
  return { S: capitalize(words), s: words, unit: whole === 1 ? 'second' : 'seconds' };
}

/** Only read a void reason aloud when it is a short human sentence, not an internal code. */
function speakableReason(reason: string | undefined): string | null {
  if (!reason) return null;
  const r = reason.trim().replace(/[.!?]+$/, '');
  if (r.length < 4 || r.length > 60 || !r.includes(' ') || /[_{}<>]/.test(r)) return null;
  return r[0]!.toLowerCase() + r.slice(1);
}

function marketOpened(event: Extract<AnnouncerEvent, { type: 'market_opened' }>, ctx: RoomContext, p: Persona): string[] {
  const m = event.market;
  const hook = endSentence(m.hook ?? m.question);
  const top = topOutcome(m);
  if (!top) return [hook];
  const label = top.outcome.label;
  const pct = formatPct(top.prob);
  const lock = event.lockInSecs && event.lockInSecs > 0 ? seconds(event.lockInSecs) : null;
  const gem = m.geminiRef;
  const gemLabel = gem ? (gem.label ?? m.outcomes.find((o) => o.id === gem.outcomeId)?.label ?? m.outcomes[0]?.label) : undefined;
  const gemLine = gem && gemLabel ? `Gemini has ${gemLabel} at ${formatPct(gem.prob)}.` : null;
  const payout = ctx.points ? null : formatPayout(top.prob);

  const closers: ByPersona<(string | null)[]> = {
    soccer: [
      lock ? `${lock.S} ${lock.unit}, get in!` : 'Get in!',
      lock ? `You've got ${lock.s} ${lock.unit}!` : 'Bets are open!',
      lock ? `${lock.S} ${lock.unit} on the clock!` : 'Who fancies it?',
    ],
    nfl: [
      lock ? `${lock.S} ${lock.unit} on the clock!` : 'Window is open!',
      lock ? `${lock.S} ${lock.unit}, folks. Get your bets in!` : 'Get your bets in, folks!',
      lock ? `You've got ${lock.s} ${lock.unit}!` : 'Step right up!',
    ],
    calm: [
      lock ? `${lock.S} ${lock.unit} to decide.` : 'Take your time.',
      lock ? `You have ${lock.s} ${lock.unit}.` : 'Bets are open.',
      lock ? `Closing in ${lock.s} ${lock.unit}.` : 'No rush.',
    ],
  };
  const bodies: ByPersona<(string | null)[]> = {
    soccer: [
      `${hook} Room's got ${label} at ${pct}.`,
      `${hook} The room says ${label}, ${pct}.`,
      `New market! ${hook} ${label} sits at ${pct}.`,
      gemLine ? `${hook} Room says ${label} at ${pct}. ${gemLine}` : null,
      payout ? `${hook} ${label} at ${pct}, ${payout}.` : null,
    ],
    nfl: [
      `Here we go! ${hook} ${label} is the favorite at ${pct}.`,
      `Market's open! ${hook} Room has ${label} at ${pct}.`,
      `${hook} The room likes ${label}, ${pct}.`,
      gemLine ? `${hook} Room has ${label} at ${pct}. ${gemLine}` : null,
      payout ? `${hook} ${label} at ${pct}. ${payout}.` : null,
    ],
    calm: [
      `${hook} ${label} is at ${pct}.`,
      `New one for you. ${hook} Room leans ${label}, ${pct}.`,
      `${hook} The room has ${label} at ${pct}.`,
      gemLine ? `${hook} ${label} is at ${pct} here. ${gemLine}` : null,
      payout ? `${hook} ${label} at ${pct}, so ${payout}.` : null,
    ],
  };
  const out: string[] = [];
  const cs = closers[p].filter((c): c is string => c !== null);
  bodies[p].forEach((b, i) => {
    if (b) out.push(`${b} ${cs[i % cs.length]}`);
  });
  return out;
}

function lockSoon(event: Extract<AnnouncerEvent, { type: 'lock_soon' }>, p: Persona): string[] {
  const t = seconds(event.secondsLeft);
  const table: ByPersona<string[]> = {
    soccer: [`${t.S} ${t.unit}! Last call!`, `Last call! ${t.S} ${t.unit}!`, `${t.S} ${t.unit} left! Get in now!`],
    nfl: [`${t.S} ${t.unit}! Last call!`, `${t.S} ${t.unit} on the clock! Bets in now!`, `Last call, folks! ${t.S} ${t.unit}!`],
    calm: [`${t.S} ${t.unit} left. Last call.`, `Last call. ${t.S} ${t.unit}.`, `Closing in ${t.s} ${t.unit}.`],
  };
  return table[p];
}

const LOCKED: ByPersona<string[]> = {
  soccer: ['Locked! No more bets.', "That's it, locked!", 'Bets are closed. Here we go!'],
  nfl: ['Locked! Bets are in.', "Window's closed. Locked!", "That's the whistle. Locked!"],
  calm: ['Locked.', 'Bets are closed.', "That's locked. Let's see."],
};

function bigTrade(event: Extract<AnnouncerEvent, { type: 'big_trade' }>, ctx: RoomContext, p: Persona): string[] {
  const { fill } = event;
  const n = fill.playerName;
  const amt = money(fill.amount, ctx);
  const o = event.outcomeLabel;
  const after = fill.price !== undefined ? formatPct(fill.price) : null;
  switch (fill.kind) {
    case 'payout':
    case 'refund':
    case 'offer_cancelled':
      return [];
    case 'amm_sell': {
      const table: ByPersona<string[]> = {
        soccer: [`${n} cashes out ${amt} of ${o}. Smart, or scared?`, `${n} takes ${amt} off the table on ${o}.`, `Cash out! ${n} banks ${amt} from ${o}.`],
        nfl: [`${n} cashes out ${amt} on ${o}. Taking the points!`, `${n} pulls ${amt} off ${o}.`, `Cash out! ${n} banks ${amt} from ${o}.`],
        calm: [`${n} cashed out ${amt} of ${o}.`, `${n} takes ${amt} off ${o}.`, `${amt} out of ${o} for ${n}.`],
      };
      return table[p];
    }
    case 'offer_posted': {
      const table: ByPersona<string[]> = {
        soccer: [`${n} is offering ${amt} on ${o}. Any takers?`, `${amt} on ${o} from ${n}. Who wants the other side?`, `${n} backs ${o} with ${amt}. Who's brave enough?`],
        nfl: [`${n} puts up ${amt} on ${o}. Any takers?`, `${amt} on ${o} from ${n}. Who wants the other side?`, `${n} is calling somebody out: ${amt} on ${o}.`],
        calm: [`${n} is offering ${amt} on ${o}.`, `${amt} on ${o} from ${n}. Takers welcome.`, `${n} backs ${o} for ${amt}.`],
      };
      return table[p];
    }
    default: {
      const table: ByPersona<(string | null)[]> = {
        soccer: [
          `${n} just dumped ${amt} on ${o}. Bold.`,
          `Big move! ${n} puts ${amt} on ${o}.`,
          `${n} goes in with ${amt} on ${o}. Confidence!`,
          after ? `${n} puts ${amt} on ${o}. That moves it to ${after}.` : null,
        ],
        nfl: [
          `${n} just dropped ${amt} on ${o}. Big-time play.`,
          `Whoa! ${n} is in for ${amt} on ${o}.`,
          `${amt} on ${o} from ${n}. Somebody's feeling it.`,
          after ? `${n} drops ${amt} on ${o}. ${o} now at ${after}.` : null,
        ],
        calm: [
          `${n} put ${amt} on ${o}.`,
          `${amt} on ${o} from ${n}. Noted.`,
          `${n} likes ${o}. ${amt} says so.`,
          after ? `${n} put ${amt} on ${o}. It's at ${after} now.` : null,
        ],
      };
      return table[p].filter((s): s is string => s !== null);
    }
  }
}

function marketResolved(event: Extract<AnnouncerEvent, { type: 'market_resolved' }>, ctx: RoomContext, p: Persona): string[] {
  const o = event.outcomeLabel;
  const winners = [...event.winners].sort((a, b) => b.amount - a.amount);
  const losers = [...event.losers].sort((a, b) => b.amount - a.amount);
  const w = winners[0];
  const l = losers[0];
  const atLock = event.market.outcome ? event.market.roomProbAtLock?.[event.market.outcome] : undefined;
  const upset = atLock !== undefined && atLock > 0 && atLock < 0.3 ? formatPct(atLock) : null;

  if (!w && !l) {
    const table: ByPersona<string[]> = {
      soccer: [`It's ${o}! Nobody had a bet on that one.`, `${o} it is! No bets down this time.`, `It's ${o}. The room sat that one out.`],
      nfl: [`It's ${o}! Nobody had action on that one.`, `${o} it is. No bets on the board.`, `It's ${o}. The room sat that one out.`],
      calm: [`It's ${o}. No bets on that one.`, `${o}. Nobody was in.`, `It's ${o}. Quiet one.`],
    };
    return table[p];
  }
  if (!w) {
    const table: ByPersona<string[]> = {
      soccer: [`It's ${o}! Nobody called it.`, `${o}! The whole room got that wrong.`, `It's ${o}. Not one of you saw it coming!`],
      nfl: [`It's ${o}! Nobody called it.`, `${o}! The whole room whiffed on that one.`, `It's ${o}, and nobody saw it coming!`],
      calm: [`It's ${o}. Nobody called it.`, `${o}. The whole room missed.`, `It's ${o}. No winners this time.`],
    };
    return table[p];
  }

  const wAmt = money(w.amount, ctx);
  const others = winners.length - 1;
  const winLine: ByPersona<string[]> = {
    soccer: [
      `It's ${o}! ${w.name} takes ${wAmt}.`,
      `There it is, ${o}! ${w.name} collects ${wAmt}.`,
      `${o} it is! ${w.name} pockets ${wAmt}.`,
    ],
    nfl: [
      `It's ${o}! ${w.name} takes ${wAmt}.`,
      `${o}! ${w.name} cashes in for ${wAmt}.`,
      `That's ${o}, folks! ${w.name} collects ${wAmt}.`,
    ],
    calm: [`It's ${o}. ${w.name} takes ${wAmt}.`, `${o}. ${w.name} collects ${wAmt}.`, `It's ${o}. ${wAmt} to ${w.name}.`],
  };
  const roast: ByPersona<string[]> = {
    soccer: [`${l?.name}, you're cooked.`, `Unlucky, ${l?.name}.`, `${l?.name}, we won't talk about that one.`],
    nfl: [`${l?.name}, you're cooked.`, `Tough break, ${l?.name}.`, `${l?.name}, shake it off.`],
    calm: [`Unlucky, ${l?.name}.`, `Sorry, ${l?.name}.`, `${l?.name}, not your moment.`],
  };
  const out: string[] = [];
  winLine[p].forEach((line, i) => {
    let s = line;
    if (others === 1) s += ` ${winners[1]!.name} wins too.`;
    else if (others > 1) s += ` ${capitalize(numberToWords(others))} more cash in too.`;
    if (l) s += ` ${roast[p][i % roast[p].length]}`;
    out.push(s);
  });
  if (upset) {
    const table: ByPersona<string> = {
      soccer: `Upset! The room had ${o} at just ${upset}. ${w.name} takes ${wAmt}.`,
      nfl: `Upset alert! The room had ${o} at just ${upset}. ${w.name} takes ${wAmt}.`,
      calm: `A surprise. The room had ${o} at ${upset}. ${w.name} takes ${wAmt}.`,
    };
    // An upset is the story: make it the only candidate.
    return [table[p]];
  }
  return out;
}

function marketVoided(event: Extract<AnnouncerEvent, { type: 'market_voided' }>, ctx: RoomContext, p: Persona): string[] {
  const back = ctx.points ? 'points' : 'money';
  const reason = speakableReason(event.reason);
  if (reason) {
    const table: ByPersona<string[]> = {
      soccer: [`That one's off: ${reason}. Everyone gets their ${back} back.`, `Market voided, ${reason}. All stakes refunded.`],
      nfl: [`That one's off: ${reason}. Everyone gets their ${back} back.`, `No play! ${capitalize(reason)}. All stakes refunded.`],
      calm: [`That one's off: ${reason}. Everyone gets their ${back} back.`, `Voided, ${reason}. Stakes are refunded.`],
    };
    return table[p];
  }
  const table: ByPersona<string[]> = {
    soccer: [`That one's off. Everyone gets their ${back} back.`, 'Market voided! All stakes refunded.', `Scrap that one. You all get your ${back} back.`],
    nfl: [`That one's off. Everyone gets their ${back} back.`, 'No play! All stakes refunded.', `Flag on the market. Everybody gets their ${back} back.`],
    calm: [`That one is off. Everyone gets their ${back} back.`, 'Voided. Stakes are refunded.', `Never mind that one. You get your ${back} back.`],
  };
  return table[p];
}

function playerJoined(event: Extract<AnnouncerEvent, { type: 'player_joined' }>, ctx: RoomContext, p: Persona): string[] {
  const n = event.name;
  const from = event.city ? ` from ${event.city}` : '';
  if (event.amount <= 0) {
    const table: ByPersona<string[]> = {
      soccer: [`${n}'s in${from}!`, `Welcome, ${n}${from}!`, `${n} joins the party${from}!`],
      nfl: [`${n}'s in${from}!`, `Welcome to the huddle, ${n}${from}!`, `${n} checks in${from}!`],
      calm: [`${n} is in${from}.`, `Welcome, ${n}${from}.`, `${n} joins us${from}.`],
    };
    return table[p];
  }
  const amt = money(event.amount, ctx);
  const remote = event.remote && !event.city ? ' remotely' : '';
  const table: ByPersona<string[]> = {
    soccer: [`${n}'s in for ${amt}${from}!`, `Welcome, ${n}${from}! In for ${amt}.`, `${n} joins${remote || from} with ${amt}!`],
    nfl: [`${n}'s in for ${amt}${from}!`, `Welcome to the huddle, ${n}${from}! In for ${amt}.`, `${n} checks in${remote || from} with ${amt}!`],
    calm: [`${n} is in for ${amt}${from}.`, `Welcome, ${n}${from}. In for ${amt}.`, `${n} joins${remote || from} with ${amt}.`],
  };
  return table[p];
}

function leaderboardChange(event: Extract<AnnouncerEvent, { type: 'leaderboard_change' }>, ctx: RoomContext, p: Persona): string[] {
  const n = event.leader;
  if (!n) return [];
  const amt = money(event.pnl, ctx);
  const tail = event.pnl > 0 ? `, up ${amt}` : event.pnl < 0 ? `, down just ${amt}` : ', dead even';
  const table: ByPersona<string[]> = {
    soccer: [`New leader: ${n}${tail}.`, `${n} goes top of the table${tail}!`, `Top spot changes hands! It's ${n}${tail}.`],
    nfl: [`New leader: ${n}${tail}.`, `${n} takes over first place${tail}!`, `Lead change! ${n} is out front${tail}.`],
    calm: [`New leader: ${n}${tail}.`, `${n} moves into first${tail}.`, `${n} leads now${tail}.`],
  };
  return table[p];
}

function gameRecap(event: Extract<AnnouncerEvent, { type: 'game_recap' }>, ctx: RoomContext, p: Persona): string[] {
  const top = event.leaderboard[0];
  const swing = event.biggestSwing;
  const verdict = event.scorecard.verdict?.trim() ? endSentence(event.scorecard.verdict) : null;
  const opener: ByPersona<string[]> = {
    soccer: [`Full time, ${event.finalScore}.`, `That's full time! ${event.finalScore}.`],
    nfl: [`That's the ballgame, ${event.finalScore}.`, `Final score, ${event.finalScore}.`],
    calm: [`That's the game. ${event.finalScore}.`, `Final score, ${event.finalScore}.`],
  };
  const winner = (i: number): string | null => {
    if (!top) return null;
    const amt = money(top.pnl, ctx);
    if (top.pnl > 0) return [`${top.name} wins the night, up ${amt}.`, `Your champion: ${top.name}, up ${amt}.`][i % 2]!;
    if (top.pnl === 0) return `${top.name} finishes on top, dead even.`;
    return `${top.name} finishes on top, down just ${amt}.`;
  };
  const swingLine = swing ? `Biggest swing: ${swing.name}, ${money(swing.amount, ctx)} on one call.` : null;
  const outro: ByPersona<string> = { soccer: 'Thanks for playing!', nfl: 'Thanks for playing, folks!', calm: 'Thanks for playing.' };
  return opener[p].map((o, i) => [o, winner(i), swingLine, verdict, outro[p]].filter((s): s is string => !!s).join(' '));
}

/** Every applicable variant for an event, in a fixed order. Empty = nothing worth saying. */
export function templateVariants(event: AnnouncerEvent, ctx: RoomContext): string[] {
  const p: Persona = isPersona(ctx.persona) ? ctx.persona : 'soccer';
  switch (event.type) {
    case 'market_opened':
      return marketOpened(event, ctx, p);
    case 'lock_soon':
      return lockSoon(event, p);
    case 'market_locked':
      return LOCKED[p];
    case 'big_trade':
      return bigTrade(event, ctx, p);
    case 'market_resolved':
      return marketResolved(event, ctx, p);
    case 'market_voided':
      return marketVoided(event, ctx, p);
    case 'player_joined':
      return playerJoined(event, ctx, p);
    case 'leaderboard_change':
      return leaderboardChange(event, ctx, p);
    case 'game_recap':
      return gameRecap(event, ctx, p);
    case 'talk_reply': {
      const t = event.text.trim();
      return t ? [t] : [];
    }
  }
}

/**
 * One template line for an event. `prefer` lets the announcer favour variants whose audio is already
 * cached (time-critical lines), still choosing deterministically among them.
 */
export function templateLine(
  event: AnnouncerEvent,
  ctx: RoomContext,
  opts: { seed?: string; prefer?: (text: string) => boolean } = {},
): string | null {
  const variants = templateVariants(event, ctx);
  if (!variants.length) return null;
  const seed = opts.seed ?? eventSeed(event, ctx);
  if (opts.prefer) {
    const preferred = variants.filter(opts.prefer);
    if (preferred.length) return pick(preferred, seed) ?? null;
  }
  return pick(variants, seed) ?? null;
}

/** Lines pre-generated at party start so the time-critical calls play instantly (PRD section 7). */
export function warmupLines(persona: Persona): string[] {
  const ctx = { persona } as RoomContext;
  const market = {} as Market;
  const out = new Set<string>();
  for (const secondsLeft of [5, 10, 3]) lockSoon({ type: 'lock_soon', market, secondsLeft }, persona).forEach((l) => out.add(l));
  LOCKED[persona].forEach((l) => out.add(l));
  for (const points of [false, true]) {
    marketVoided({ type: 'market_voided', market }, { ...ctx, points }, persona).forEach((l) => out.add(l));
  }
  out.add(persona === 'calm' ? 'Last call.' : 'Last call!');
  return [...out];
}
