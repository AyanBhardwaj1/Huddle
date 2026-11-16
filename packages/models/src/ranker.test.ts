import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmClient, MarketCandidate, RoomContext } from '@huddle/shared';
import { allowedNumbers, buildRankerUserPrompt, createQuestionRanker, LlmQuestionRanker, QUESTION_RANKER_SYSTEM, RANKER_TIMEOUT_MS, templatePicks, textIsAcceptable } from './index';

const ctx: RoomContext = {
  partyName: 'Sunday Crew',
  persona: 'nfl',
  sport: 'nfl',
  points: false,
  score: 'DAL 7, TEN 3',
  clock: 'Q2 4:20',
  home: 'Dallas Cowboys',
  away: 'Tennessee Titans',
  leaderboard: [
    { name: 'Ayan', pnl: 4_200_000, streak: 3 },
    { name: 'Maya', pnl: -1_000_000, streak: -2 },
  ],
  recentResults: [{ question: 'Do the Cowboys convert on 3rd & 3?', outcome: 'Yes' }],
};

const YES_NO = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

const candidates: MarketCandidate[] = [
  {
    templateId: 'nfl.run_pass',
    kind: 'moment',
    question: 'Run or pass on 1st & 10?',
    hook: 'Titans at the line. Run or pass?',
    outcomes: [
      { id: 'run', label: 'Run' },
      { id: 'pass', label: 'Pass' },
    ],
    prior: { run: 0.5, pass: 0.5 },
    lockAfterSecs: 15,
    resolver: { type: 'play_type', params: {} },
    priority: 20,
  },
  {
    templateId: 'nfl.conversion',
    kind: 'moment',
    question: 'Do the Titans convert on 3rd & 2?',
    hook: '3rd and 2 for the Titans. The model says 61%.',
    outcomes: YES_NO,
    prior: { yes: 0.61, no: 0.39 },
    lockAfterSecs: 15,
    resolver: { type: 'first_down_result', params: {} },
    priority: 72,
  },
  {
    templateId: 'nfl.drive_result',
    kind: 'moment',
    question: 'Titans drive: touchdown, field goal or no score?',
    hook: 'Titans ball at their own 25. How does this drive end?',
    outcomes: [
      { id: 'td', label: 'Touchdown' },
      { id: 'fg', label: 'Field goal' },
      { id: 'none', label: 'No score' },
    ],
    prior: { td: 0.22, fg: 0.14, none: 0.64 },
    lockAfterSecs: 20,
    resolver: { type: 'drive_result', params: {} },
    priority: 50,
  },
];

/** Template fallback for these candidates: highest priority first. */
const FALLBACK_2 = [
  { index: 1, question: candidates[1]!.question, hook: candidates[1]!.hook },
  { index: 2, question: candidates[2]!.question, hook: candidates[2]!.hook },
];

function fakeLlm(reply: unknown | (() => Promise<unknown>), available = true): LlmClient & { calls: { system: string; user: string; maxTokens?: number; timeoutMs?: number }[] } {
  const calls: { system: string; user: string; maxTokens?: number; timeoutMs?: number }[] = [];
  return {
    available,
    calls,
    async completeJson(req) {
      calls.push(req);
      return typeof reply === 'function' ? (reply as () => Promise<unknown>)() : reply;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('question ranker', () => {
  it('uses valid LLM picks and phrasing', async () => {
    const llm = fakeLlm({
      picks: [
        { index: 1, question: 'Money down: do the Titans move the chains on 3rd & 2?', hook: 'Third and short, Titans. Ayan is on a heater. Who is brave enough to fade him?' },
        { index: 2, question: 'How does this Titans drive end?', hook: 'Six, three or nothing for Tennessee?' },
      ],
    });
    const picks = await new LlmQuestionRanker(llm).rank(candidates, ctx, 2);
    expect(picks).toEqual([
      { index: 1, question: 'Money down: do the Titans move the chains on 3rd & 2?', hook: 'Third and short, Titans. Ayan is on a heater. Who is brave enough to fade him?' },
      { index: 2, question: 'How does this Titans drive end?', hook: 'Six, three or nothing for Tennessee?' },
    ]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.timeoutMs).toBe(RANKER_TIMEOUT_MS);
    expect(RANKER_TIMEOUT_MS).toBe(1500);
  });

  it('sends the candidates, the model percentages and the room context, and states the hard rules', async () => {
    const llm = fakeLlm(null);
    await new LlmQuestionRanker(llm).rank(candidates, ctx, 2);
    const { system, user } = llm.calls[0]!;
    expect(system).toBe(QUESTION_RANKER_SYSTEM);
    expect(system).toMatch(/Never invent or change numbers/);
    expect(system).toMatch(/No slurs, no harassment/);
    expect(system).toMatch(/Never encourage anyone to chase losses/);
    expect(system).toMatch(/at most 80 characters/);
    expect(system).toMatch(/at most 25 words/);
    expect(system).toContain('{"picks":[{"index":0,"question":"...","hook":"..."}]}');
    expect(user).toBe(buildRankerUserPrompt(candidates, ctx, 2));
    const payload = JSON.parse(user.slice(user.indexOf('{'))) as { maxPicks: number; room: Record<string, unknown>; candidates: { index: number; question: string; outcomes: { label: string; modelPercent: number }[] }[] };
    expect(payload.maxPicks).toBe(2);
    expect(payload.room).toMatchObject({ party: 'Sunday Crew', score: 'DAL 7, TEN 3', clock: 'Q2 4:20', match: 'Dallas Cowboys vs Tennessee Titans' });
    expect(payload.candidates.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(payload.candidates[1]!.outcomes).toEqual([{ label: 'Yes', modelPercent: 61 }, { label: 'No', modelPercent: 39 }]);
    // Money is never sent to the LLM.
    expect(user).not.toContain('4200000');
  });

  it('falls back to template text, highest priority first, when the LLM is unavailable', async () => {
    const llm = fakeLlm({ picks: [{ index: 0, question: 'x?', hook: 'y' }] }, false);
    expect(await new LlmQuestionRanker(llm).rank(candidates, ctx, 2)).toEqual(FALLBACK_2);
    expect(llm.calls).toHaveLength(0);
    expect(templatePicks(candidates, 5).map((p) => p.index)).toEqual([1, 2, 0]);
    expect(await createQuestionRanker(llm).rank([], ctx, 2)).toEqual([]);
    expect(await createQuestionRanker(llm).rank(candidates, ctx, 0)).toEqual([]);
  });

  it('falls back on null, invalid shapes and out-of-range picks', async () => {
    const bad: unknown[] = [
      null,
      'not json',
      {},
      { picks: [] },
      { picks: 'none' },
      { picks: [{ index: 1 }] },
      { picks: [{ index: '1', question: 'q?', hook: 'h' }] },
      { picks: [{ index: 1.5, question: 'q?', hook: 'h' }] },
      { picks: [{ index: -1, question: 'q?', hook: 'h' }] },
      { picks: [{ index: 7, question: 'A fine question?', hook: 'A fine hook.' }] },
      { choice: 1, text: 'wrong schema' },
    ];
    for (const reply of bad) {
      expect(await new LlmQuestionRanker(fakeLlm(reply)).rank(candidates, ctx, 2), JSON.stringify(reply)).toEqual(FALLBACK_2);
    }
    // A client that throws (it should not) is handled the same way.
    const throwing = fakeLlm(async () => {
      throw new Error('boom');
    });
    expect(await new LlmQuestionRanker(throwing).rank(candidates, ctx, 2)).toEqual(FALLBACK_2);
  });

  it('falls back after 1.5 s when the LLM is slow', async () => {
    vi.useFakeTimers();
    const slow = fakeLlm(() => new Promise((resolve) => setTimeout(() => resolve({ picks: [{ index: 0, question: 'Too late?', hook: 'Too late.' }] }), 5000)));
    let done: unknown;
    const p = new LlmQuestionRanker(slow).rank(candidates, ctx, 2).then((r) => (done = r));
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toEqual(FALLBACK_2);

    // Just inside the limit is fine.
    const quick = fakeLlm(() => new Promise((resolve) => setTimeout(() => resolve({ picks: [{ index: 2, question: 'Six, three or zip for the Titans?', hook: 'Drive time.' }] }), 1400)));
    const q = new LlmQuestionRanker(quick).rank(candidates, ctx, 1);
    await vi.advanceTimersByTimeAsync(1400);
    expect(await q).toEqual([{ index: 2, question: 'Six, three or zip for the Titans?', hook: 'Drive time.' }]);
  });

  it('keeps the pick but restores template text when the LLM invents a number', async () => {
    const llm = fakeLlm({
      picks: [
        { index: 1, question: 'Titans convert on 3rd & 5?', hook: 'The model says 75%. Easy money.' },
        { index: 2, question: 'How does this Titans drive end?', hook: 'Titans at their own 25, 64% says no points.' },
      ],
    });
    const picks = await new LlmQuestionRanker(llm).rank(candidates, ctx, 2);
    expect(picks[0]).toEqual({ index: 1, question: candidates[1]!.question, hook: candidates[1]!.hook });
    // Numbers copied from the candidate (25, and the 64% model price) are allowed.
    expect(picks[1]).toEqual({ index: 2, question: 'How does this Titans drive end?', hook: 'Titans at their own 25, 64% says no points.' });
    expect([...allowedNumbers(candidates[1]!)].sort()).toEqual(['2', '3', '39', '61']);
  });

  it('rejects long questions, long hooks and loss-chasing lines one text at a time', async () => {
    const long = 'Do the Tennessee Titans, who have looked shaky all afternoon, somehow convert this 3rd & 2?';
    expect(long.length).toBeGreaterThan(80);
    const wordy = Array.from({ length: 26 }, () => 'go').join(' ');
    const llm = fakeLlm({
      picks: [
        { index: 1, question: long, hook: 'Short and sweet.' },
        { index: 2, question: 'Drive time: how does it end?', hook: wordy },
        { index: 0, question: 'Run or pass?', hook: 'Maya, double or nothing to win it back!' },
      ],
    });
    const picks = await new LlmQuestionRanker(llm).rank(candidates, ctx, 3);
    expect(picks).toEqual([
      { index: 1, question: candidates[1]!.question, hook: 'Short and sweet.' },
      { index: 2, question: 'Drive time: how does it end?', hook: candidates[2]!.hook },
      { index: 0, question: 'Run or pass?', hook: candidates[0]!.hook },
    ]);
    expect(textIsAcceptable('You are due, bet more!', candidates[0]!, 'hook')).toBe(false);
    expect(textIsAcceptable('  ', candidates[0]!, 'hook')).toBe(false);
    expect(textIsAcceptable('Run or pass on 1st & 10?', candidates[0]!, 'question')).toBe(true);
  });

  it('caps the picks, drops duplicates and unknown indexes, and trims text', async () => {
    const llm = fakeLlm({
      picks: [
        { index: 2, question: '  How does this drive end?  ', hook: ' Drive time. ' },
        { index: 2, question: 'Same one again?', hook: 'Again.' },
        { index: 9, question: 'Ghost question?', hook: 'Boo.' },
        { index: 1, question: 'Do they convert?', hook: 'Money down.' },
        { index: 0, question: 'Run or pass?', hook: 'Call it.' },
      ],
    });
    expect(await new LlmQuestionRanker(llm).rank(candidates, ctx, 2)).toEqual([
      { index: 2, question: 'How does this drive end?', hook: 'Drive time.' },
      { index: 1, question: 'Do they convert?', hook: 'Money down.' },
    ]);
    // Asking for more picks than there are candidates is capped too.
    expect(await new LlmQuestionRanker(fakeLlm(null)).rank(candidates.slice(0, 1), ctx, 5)).toEqual([{ index: 0, question: candidates[0]!.question, hook: candidates[0]!.hook }]);
  });
});
