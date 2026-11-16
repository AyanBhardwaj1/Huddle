import { USDC, type AnnouncerEvent, type LlmClient, type Persona } from '@huddle/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_WORDS_PER_LINE,
  announcerSystemPrompt,
  announcerUserPrompt,
  countWords,
  factsFor,
  llmLine,
  safetyViolation,
  validateLines,
} from './lines';
import { extractNumbers, numberToWords, speakable, spokenNumbers, wordsToDigits } from './numbers';
import { sfxFor } from './sfx';
import { money, templateLine, templateVariants, warmupLines } from './templates';
import { allEvents, corners, fill, penalty, room, scorecard, winner } from './test/fixtures';

const PERSONAS: Persona[] = ['soccer', 'nfl', 'calm'];

describe('numbers', () => {
  it('writes and reads number words', () => {
    expect(numberToWords(5)).toBe('five');
    expect(numberToWords(20)).toBe('twenty');
    expect(numberToWords(45)).toBe('forty-five');
    expect(numberToWords(120)).toBe('one hundred twenty');
    expect(wordsToDigits('twenty five bucks on seven')).toBe('25 bucks on 7');
    expect(wordsToDigits('Twenty-five seconds')).toBe('25 seconds');
    expect(wordsToDigits('a hundred and five points')).toBe('105 points');
    expect(wordsToDigits('three hundred')).toBe('300');
    expect(wordsToDigits('fifteen, then two')).toBe('15, then 2');
    expect(wordsToDigits('three-two to Portugal')).toBe('3-2 to Portugal');
  });

  it('leaves a lone "one" and ordinary words alone', () => {
    expect(wordsToDigits('That one is off')).toBe('That one is off');
    expect(wordsToDigits('one dollar', { convertOne: true })).toBe('1 dollar');
    expect(wordsToDigits('a penalty for someone')).toBe('a penalty for someone');
    expect(wordsToDigits('often tension')).toBe('often tension');
  });

  it('extracts spoken numbers', () => {
    expect(extractNumbers('77%, $1 pays $1.30, 2-1')).toEqual([77, 1, 1.3, 2, 1]);
    expect(spokenNumbers('Twenty seconds, Jake put $8 down')).toEqual([20, 8]);
  });

  it('makes captions speakable without server-side normalisation', () => {
    expect(speakable('Jake just dumped $8 on NO. Bold.')).toBe('Jake just dumped 8 dollars on NO. Bold.');
    expect(speakable('Priya takes $14.20')).toBe('Priya takes 14 dollars 20');
    expect(speakable("Room's got Yes at 77%.")).toBe("Room's got Yes at 77 percent.");
    expect(speakable('up 8 pts')).toBe('up 8 points');
    expect(speakable('Full time, Portugal 2-1 Spain.')).toBe('Full time, Portugal 2 1 Spain.');
    expect(speakable('Final score, 21-14.', 'nfl')).toBe('Final score, 21 to 14.');
    expect(speakable('$1 pays $1.30')).toBe('1 dollar pays 1 dollar 30');
  });
});

describe('template lines (no keys needed)', () => {
  it('produces a line for every event in every persona', () => {
    for (const persona of PERSONAS) {
      for (const event of allEvents()) {
        const line = templateLine(event, room({ persona }));
        expect(line, `${persona}/${event.type}`).toBeTruthy();
        expect(line).not.toMatch(/undefined|null|NaN|\[object/);
        expect(safetyViolation(line!), `${persona}/${event.type}: ${line}`).toBeNull();
      }
    }
  });

  it('offers several variants per event per persona, all free of invented numbers', () => {
    for (const persona of PERSONAS) {
      for (const event of allEvents()) {
        if (event.type === 'talk_reply') continue;
        const ctx = room({ persona });
        const variants = templateVariants(event, ctx);
        expect(variants.length, `${persona}/${event.type}`).toBeGreaterThanOrEqual(2);
        expect(new Set(variants).size).toBe(variants.length);
        const { facts, room: roomFacts } = announcerUserPrompt(event, ctx);
        for (const v of variants) {
          const res = validateLines({ lines: [v] }, 'game_recap', { facts: facts.facts, mustMention: [] }, roomFacts);
          // Templates may run longer than an LLM line; everything else must pass the same validator.
          if (!res.ok) expect(res.reason, `${persona}/${event.type}: ${v}`).toBe('too_long');
        }
      }
    }
  });

  it('is deterministic for a given event and varies across events', () => {
    const ctx = room();
    const e: AnnouncerEvent = { type: 'big_trade', market: penalty, fill: fill(), outcomeLabel: 'No' };
    expect(templateLine(e, ctx)).toBe(templateLine(e, ctx));
    expect(templateLine(e, ctx, { seed: 'a' })).toBe(templateLine(e, ctx, { seed: 'a' }));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(templateLine(e, ctx, { seed: `s${i}` })!);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('matches the PRD examples in spirit', () => {
    const ctx = room();
    const opened = templateVariants({ type: 'market_opened', market: penalty, lockInSecs: 20 }, ctx);
    expect(opened[0]).toBe("Penalty to Portugal! Ronaldo steps up. Room's got Yes at 77%. Twenty seconds, get in!");
    expect(templateVariants({ type: 'lock_soon', market: penalty, secondsLeft: 5 }, ctx)[0]).toBe('Five seconds! Last call!');
    expect(templateVariants({ type: 'big_trade', market: penalty, fill: fill(), outcomeLabel: 'No' }, ctx)[0]).toBe('Jake just dumped $8 on No. Bold.');
    expect(templateVariants({ type: 'player_joined', name: 'Priya', amount: 10 * USDC, remote: true, city: 'Chicago' }, ctx)[0]).toBe(
      "Priya's in for $10 from Chicago!",
    );
    expect(templateVariants({ type: 'leaderboard_change', leader: 'Ayan', pnl: 12 * USDC }, ctx)[0]).toBe('New leader: Ayan, up $12.');
    const resolved = templateVariants(
      { type: 'market_resolved', market: penalty, outcomeLabel: 'Yes', winners: [{ name: 'Priya', amount: 6 * USDC }], losers: [{ name: 'Jake', amount: 8 * USDC }] },
      ctx,
    );
    expect(resolved[0]).toBe("It's Yes! Priya takes $6. Jake, you're cooked.");
  });

  it('mentions Gemini when the market has a reference', () => {
    const variants = templateVariants({ type: 'market_opened', market: winner }, room());
    expect(variants.some((v) => v.includes('Gemini has Portugal at 46%'))).toBe(true);
    expect(variants.every((v) => v.includes('52%'))).toBe(true);
  });

  it('formats money through formatUsd, including points mode', () => {
    expect(money(8 * USDC, { points: false })).toBe('$8');
    expect(money(14_200_000, { points: false })).toBe('$14.20');
    expect(money(8 * USDC, { points: true })).toBe('8 pts');
    expect(money(-3 * USDC, { points: false })).toBe('$3');
    const pts = room({ points: true });
    expect(templateVariants({ type: 'big_trade', market: penalty, fill: fill(), outcomeLabel: 'No' }, pts)[0]).toBe('Jake just dumped 8 pts on No. Bold.');
    expect(templateVariants({ type: 'market_voided', market: corners }, pts)[0]).toContain('points back');
    expect(templateVariants({ type: 'market_opened', market: penalty }, pts).join(' ')).not.toContain('$');
  });

  it('handles the awkward cases', () => {
    const ctx = room();
    // No bets at all, nobody right, an upset, several winners.
    expect(templateLine({ type: 'market_resolved', market: penalty, outcomeLabel: 'No', winners: [], losers: [] }, ctx)).toMatch(/No/);
    expect(templateLine({ type: 'market_resolved', market: penalty, outcomeLabel: 'No', winners: [], losers: [{ name: 'Jake', amount: USDC }] }, ctx)).not.toMatch(/takes/);
    const upset = templateLine(
      {
        type: 'market_resolved',
        market: { ...penalty, outcome: 'no', roomProbAtLock: { yes: 0.77, no: 0.23 } },
        outcomeLabel: 'No',
        winners: [{ name: 'Jake', amount: 9 * USDC }],
        losers: [{ name: 'Priya', amount: 3 * USDC }],
      },
      ctx,
    );
    expect(upset).toContain('23%');
    const many = templateVariants(
      { type: 'market_resolved', market: penalty, outcomeLabel: 'Yes', winners: [{ name: 'A', amount: 3 * USDC }, { name: 'B', amount: 2 * USDC }, { name: 'C', amount: USDC }], losers: [] },
      ctx,
    );
    expect(many[0]).toContain('Two more cash in too.');
    // Trades that are not news.
    expect(templateLine({ type: 'big_trade', market: penalty, fill: fill({ kind: 'refund' }), outcomeLabel: 'No' }, ctx)).toBeNull();
    expect(templateLine({ type: 'big_trade', market: penalty, fill: fill({ kind: 'amm_sell' }), outcomeLabel: 'No' }, ctx)).toMatch(/cash|takes/i);
    // Internal void codes are not read aloud.
    expect(templateLine({ type: 'market_voided', market: corners, reason: 'feed_timeout' }, ctx)).not.toContain('feed_timeout');
    expect(templateLine({ type: 'leaderboard_change', leader: 'Ayan', pnl: 0 }, ctx)).toContain('dead even');
    expect(templateLine({ type: 'leaderboard_change', leader: '', pnl: 0 }, ctx)).toBeNull();
    expect(templateLine({ type: 'talk_reply', text: '   ' }, ctx)).toBeNull();
    expect(templateLine({ type: 'lock_soon', market: penalty, secondsLeft: 1 }, ctx)).toMatch(/One second[!.]/);
    expect(templateLine({ type: 'player_joined', name: 'Sam', amount: 0, remote: false }, ctx)).not.toContain('$');
  });

  it('recaps the game with winner, biggest swing and the scorecard verdict', () => {
    const line = templateLine(
      { type: 'game_recap', scorecard, leaderboard: [{ name: 'Ayan', pnl: 12 * USDC }], biggestSwing: { name: 'Jake', amount: 8 * USDC, question: 'q' }, finalScore: 'Portugal 2-1 Spain' },
      room(),
    )!;
    expect(line).toContain('Portugal 2-1 Spain');
    expect(line).toContain('Ayan');
    expect(line).toContain('$12');
    expect(line).toContain('Biggest swing: Jake, $8');
    expect(line).toContain('The room beat the model tonight, and edged Gemini too.');
  });

  it('lists the common lines to pre-generate', () => {
    const lines = warmupLines('soccer');
    expect(lines).toContain('Five seconds! Last call!');
    expect(lines).toContain('Locked! No more bets.');
    expect(lines).toContain('Last call!');
    expect(lines.length).toBeGreaterThanOrEqual(12);
    expect(warmupLines('calm')).toContain('Locked.');
  });
});

describe('announcer_lines prompt', () => {
  it('states the hard rules and the persona', () => {
    const sys = announcerSystemPrompt(room({ persona: 'nfl' }));
    expect(sys).toMatch(/Never invent numbers/);
    expect(sys).toMatch(/slurs/);
    expect(sys).toMatch(/chase losses/);
    expect(sys).toMatch(/Never imitate, quote or name a real commentator/);
    expect(sys).toMatch(/play-by-play/);
    expect(sys).toContain(`${MAX_WORDS_PER_LINE} words`);
    expect(sys).toContain('{"lines": string[]}');
  });

  it('passes every number in as a formatted fact', () => {
    const { user } = announcerUserPrompt({ type: 'market_opened', market: penalty, lockInSecs: 20 }, room());
    expect(user).toContain('EVENT: market_opened');
    expect(user).toContain('"room":"77%"');
    expect(user).toContain('20 seconds');
    expect(user).toContain('$1 pays $1.30');
    expect(user).toContain('Portugal 2-1 Spain');
    const trade = factsFor({ type: 'big_trade', market: penalty, fill: fill(), outcomeLabel: 'No' }, room({ points: true }));
    expect(trade.facts.amount).toBe('8 pts');
    expect(trade.mustMention).toEqual(['Jake', '8 pts']);
  });
});

describe('validateLines', () => {
  const ctx = room();
  const event: AnnouncerEvent = { type: 'market_opened', market: penalty, lockInSecs: 20 };
  const { facts, room: roomFacts } = announcerUserPrompt(event, ctx);
  const check = (lines: unknown) => validateLines(lines, event.type, facts, roomFacts);

  it('accepts a good reply', () => {
    const res = check({ lines: ['Penalty to Portugal! Ronaldo steps up.', "Room's got him at 77%. Twenty seconds, get in!"] });
    expect(res).toEqual({ ok: true, lines: ['Penalty to Portugal! Ronaldo steps up.', "Room's got him at 77%. Twenty seconds, get in!"] });
  });

  it('rejects invented numbers, in digits or in words', () => {
    expect(check({ lines: ['Ronaldo steps up, the room has him at 85%!'] })).toMatchObject({ ok: false, reason: 'invented_number', detail: '85' });
    expect(check({ lines: ['The room says 77%. Thirty seconds, get in!'] })).toMatchObject({ ok: false, reason: 'invented_number', detail: '30' });
    expect(check({ lines: ['77% for Yes. He has scored 9 of his last 10!'] })).toMatchObject({ ok: false, reason: 'invented_number' });
  });

  it('rejects the wrong shape, too many lines and long lines', () => {
    expect(check('Penalty!')).toMatchObject({ ok: false, reason: 'not_json_lines' });
    expect(check({ lines: 'Penalty!' })).toMatchObject({ ok: false, reason: 'not_json_lines' });
    expect(check({ lines: [] })).toMatchObject({ ok: false, reason: 'empty' });
    expect(check({ lines: ['77% a', 'b', 'c'] })).toMatchObject({ ok: false, reason: 'line_count' });
    const long = `77% ${Array.from({ length: 26 }, () => 'go').join(' ')}`;
    expect(countWords(long)).toBeGreaterThan(MAX_WORDS_PER_LINE);
    expect(check({ lines: [long] })).toMatchObject({ ok: false, reason: 'too_long' });
    expect(validateLines({ lines: ['a', 'b', 'c'] }, 'game_recap', { facts: {}, mustMention: [] }, {})).toMatchObject({ ok: true });
  });

  it('rejects a line that drops the key fact', () => {
    expect(check({ lines: ['Penalty to Portugal! Get your bets in!'] })).toMatchObject({ ok: false, reason: 'missing_fact', detail: '77%' });
  });

  it('rejects chasing losses, abuse, imitation and markup', () => {
    expect(check({ lines: ['77% on Yes. Jake, double down and win it back!'] })).toMatchObject({ ok: false, reason: 'chase_losses' });
    expect(check({ lines: ['77% on Yes. This one is a sure thing!'] })).toMatchObject({ ok: false, reason: 'chase_losses' });
    expect(check({ lines: ['77% on Yes. Jake, you idiot.'] })).toMatchObject({ ok: false, reason: 'abuse' });
    expect(check({ lines: ['77% on Yes, as Peter Drury would say!'] })).toMatchObject({ ok: false, reason: 'imitation' });
    expect(check({ lines: ['**Penalty!** 77% on Yes'] })).toMatchObject({ ok: false, reason: 'formatting' });
    expect(check({ lines: ['Penalty! 77% on Yes ⚽'] })).toMatchObject({ ok: false, reason: 'formatting' });
    expect(safetyViolation("Jake, you're cooked.")).toBeNull();
  });
});

describe('llmLine', () => {
  const event: AnnouncerEvent = { type: 'big_trade', market: penalty, fill: fill(), outcomeLabel: 'No' };

  function llm(reply: unknown): LlmClient & { completeJson: ReturnType<typeof vi.fn> } {
    return { available: true, completeJson: vi.fn(async () => reply) };
  }

  it('returns the validated LLM text', async () => {
    const client = llm({ lines: ['Jake slams $8 on No. Brave man.'] });
    const res = await llmLine(client, event, room());
    expect(res.text).toBe('Jake slams $8 on No. Brave man.');
    const req = client.completeJson.mock.calls[0]![0] as { system: string; user: string; timeoutMs: number };
    expect(req.timeoutMs).toBe(1500);
    expect(req.user).toContain('"amount":"$8"');
  });

  it('returns null text when the LLM is silent or breaks a rule', async () => {
    expect(await llmLine(llm(null), event, room())).toMatchObject({ text: null, rejection: 'no_reply' });
    expect(await llmLine(llm({ lines: ['Jake slams $80 on No.'] }), event, room())).toMatchObject({ text: null, rejection: 'invented_number' });
    expect(await llmLine(llm({ lines: ['Somebody put $8 on No.'] }), event, room())).toMatchObject({ text: null, rejection: 'missing_fact' });
  });
});

describe('sfxFor', () => {
  const ctx = room();
  it('maps events to stingers', () => {
    expect(sfxFor({ type: 'market_locked', market: penalty }, ctx)).toBe('lock_buzzer');
    expect(sfxFor({ type: 'lock_soon', market: penalty, secondsLeft: 5 }, ctx)).toBeUndefined();
    expect(sfxFor({ type: 'player_joined', name: 'P', amount: 1, remote: false }, ctx)).toBeUndefined();
    // A goal in soccer: horn. A touchdown in the NFL: crowd roar.
    const scored: AnnouncerEvent = { type: 'market_resolved', market: penalty, outcomeLabel: 'Yes', winners: [{ name: 'Priya', amount: 6 * USDC }], losers: [{ name: 'Jake', amount: 2 * USDC }] };
    expect(sfxFor(scored, ctx)).toBe('goal_horn');
    expect(sfxFor({ ...scored, market: { ...penalty, question: 'Touchdown on this drive?' } }, room({ sport: 'nfl' }))).toBe('crowd_roar');
    // A payout on a non-scoring market: cash register.
    expect(sfxFor({ ...scored, market: corners }, ctx)).toBe('cash_register');
    expect(sfxFor({ ...scored, outcomeLabel: 'No' }, ctx)).toBe('cash_register');
    // Nobody won, or one big loss: sad trombone.
    expect(sfxFor({ ...scored, winners: [] }, ctx)).toBe('sad_trombone');
    expect(sfxFor({ ...scored, market: corners, losers: [{ name: 'Jake', amount: 8 * USDC }] }, ctx)).toBe('sad_trombone');
    // No bets at all.
    expect(sfxFor({ ...scored, market: corners, winners: [], losers: [] }, ctx)).toBe('crowd_roar');
    expect(sfxFor({ type: 'game_recap', scorecard, leaderboard: [], finalScore: '1-0' }, ctx)).toBe('crowd_roar');
  });
});
