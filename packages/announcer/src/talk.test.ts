import { USDC, type LlmClient, type TalkContext } from '@huddle/shared';
import { describe, expect, it, vi } from 'vitest';
import { createAnnouncer } from './index';
import { silentLogger } from './log';
import { answerTalk, detectIntent, matchOutcome, normalize, parseAmount, rankMarkets, rephraseReply, stem, tokens } from './talk';
import { corners, lockedMarket, market, penalty, talk, winner } from './test/fixtures';

const ctx = talk();

describe('TALK parsing helpers', () => {
  it('normalises speech: number words, punctuation, case', () => {
    expect(normalize('Put FIVE on Yes, for me!')).toBe('put 5 on yes for me');
    expect(normalize('twenty-five bucks on Portugal.')).toBe('25 bucks on portugal');
    expect(normalize("What's the score?")).toBe("what's the score");
    expect(normalize('$5.50 on no')).toBe('$5.50 on no');
  });

  it('stems word forms to the same token', () => {
    expect(new Set(['score', 'scores', 'scored', 'scoring'].map(stem)).size).toBe(1);
    expect(new Set(['hit', 'hits', 'hitting'].map(stem)).size).toBe(1);
    expect(new Set(['penalty', 'penalties'].map(stem)).size).toBe(1);
    expect(new Set(['corner', 'corners'].map(stem)).size).toBe(1);
    expect(new Set(['miss', 'misses'].map(stem)).size).toBe(1);
    expect(tokens('What are the odds Portugal hits seven?')).toEqual(['portugal', 'hit', '7']);
  });

  it('parses amounts in digits and words', () => {
    const amt = (s: string) => parseAmount(normalize(s));
    expect(amt('put 5 on yes')).toBe(5);
    expect(amt('five bucks on Portugal')).toBe(5);
    expect(amt('bet twenty five dollars on no')).toBe(25);
    expect(amt('$2.50 on yes')).toBe(2.5);
    expect(amt('a dollar on yes')).toBe(1);
    expect(amt('one on yes')).toBe(1);
    expect(amt('fifty cents on no')).toBe(0.5);
    expect(amt('put 5 on Portugal reaching seven corners')).toBe(5);
    expect(amt('yes for ten')).toBe(10);
    expect(amt('put it on yes')).toBeNull();
    expect(amt('ten points on Spain')).toBe(10);
  });

  it('detects intents', () => {
    const intent = (s: string) => detectIntent(normalize(s));
    expect(intent('what are the odds Portugal hits seven?')).toBe('odds');
    expect(intent('How likely is a red card?')).toBe('odds');
    expect(intent("what's Spain paying")).toBe('odds');
    expect(intent('put 5 on yes for me')).toBe('bet');
    expect(intent('five bucks on Portugal')).toBe('bet');
    expect(intent("I'll take ten on Spain")).toBe('bet');
    expect(intent("who's winning?")).toBe('leaderboard');
    expect(intent('who is in the lead')).toBe('leaderboard');
    expect(intent("who's winning the game")).toBe('score');
    expect(intent("what's the score?")).toBe('score');
    expect(intent('how much do I have')).toBe('balance');
    expect(intent("what's open")).toBe('markets');
    expect(intent('what happened on the last one')).toBe('results');
    expect(intent('how does this work')).toBe('help');
    expect(intent('hello there')).toBe('greeting');
    expect(intent('tell me a joke about cheese')).toBe('unknown');
  });

  it('ranks markets by keywords and matches outcomes', () => {
    const open = [winner, corners, penalty];
    expect(rankMarkets('odds Portugal hits seven', open)[0]!.market.id).toBe('m-corners');
    expect(rankMarkets('is Ronaldo going to score the penalty', open)[0]!.market.id).toBe('m-pen');
    expect(rankMarkets('who wins the match', open)[0]!.market.id).toBe('m-winner');
    expect(matchOutcome(winner, 'portugal', ctx)?.id).toBe('home');
    expect(matchOutcome(winner, 'the away team', ctx)?.id).toBe('away');
    expect(matchOutcome(winner, 'a tie', ctx)?.id).toBe('draw');
    expect(matchOutcome(penalty, 'yeah', ctx)?.id).toBe('yes');
    expect(matchOutcome(penalty, 'nope', ctx)?.id).toBe('no');
    expect(matchOutcome(penalty, 'portugal', ctx)).toBeNull();
  });
});

describe('answerTalk: odds', () => {
  it('answers "what are the odds Portugal hits seven?" with live numbers from the matching market', () => {
    const r = answerTalk('What are the odds Portugal hits seven?', ctx);
    expect(r.intent).toBe('odds');
    expect(r.draft).toBeUndefined();
    expect(r.text).toBe('Will Portugal reach 7 corners? Yes is at 61%, $1 pays $1.64. No 39%.');
  });

  it('uses market.price, not the prior', () => {
    const moved = talk({ markets: [winner, { ...corners, price: { yes: 0.7, no: 0.3 } }, penalty] });
    expect(answerTalk('odds on Portugal reaching seven corners', moved).text).toContain('Yes is at 70%, $1 pays $1.43');
  });

  it('includes the Gemini price when the market has one, leading with the outcome asked about', () => {
    const r = answerTalk('what are the odds on Spain?', ctx);
    expect(r.text).toBe('Who wins the match? Spain is at 25%, $1 pays $4.00. Portugal 52%, Draw 23%. Gemini has Portugal at 46%.');
    expect(answerTalk("what's the price on Portugal to win the match", ctx).text).toContain('Portugal is at 52%, $1 pays $1.92');
  });

  it('finds markets by player or event words', () => {
    expect(answerTalk('odds on Ronaldo scoring?', ctx).text).toContain('Will Ronaldo score this penalty? Yes is at 77%, $1 pays $1.30. No 23%.');
    expect(answerTalk('what are the chances of a red card', ctx).text).toBe(
      "Will there be a red card before half time? No closed at 88%. Yes 12%. That one's locked.",
    );
  });

  it('falls back to the newest moment market, and says so when nothing is open', () => {
    expect(answerTalk('what are the odds?', ctx).text).toContain('Will Ronaldo score this penalty?');
    expect(answerTalk('what are the odds?', talk({ markets: [] })).text).toMatch(/Nothing's open/);
    expect(answerTalk('what are the odds?', talk({ markets: [{ ...penalty, state: 'resolved' }] })).text).toMatch(/Nothing's open/);
  });

  it('speaks points instead of dollars in points mode', () => {
    const r = answerTalk('odds on the penalty', talk({ points: true }));
    expect(r.text).toContain('1 point pays 1.30');
    expect(r.text).not.toContain('$');
  });

  it('treats a bare market mention as an odds question', () => {
    const r = answerTalk('Ronaldo penalty?', ctx);
    expect(r.intent).toBe('odds');
    expect(r.text).toContain('77%');
  });
});

describe('answerTalk: draft bets (the voice path never moves money)', () => {
  it('drafts "put 5 on yes for me" on the live moment market', () => {
    const r = answerTalk('put 5 on yes for me', ctx);
    expect(r.intent).toBe('bet');
    expect(r.draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 5 * USDC });
    expect(r.text).toBe('Drafted $5 on Yes at 77%: Will Ronaldo score this penalty? Confirm it in the app, Jake.');
  });

  it('drafts "five bucks on Portugal" on the market that has Portugal as an outcome', () => {
    const r = answerTalk('five bucks on Portugal', ctx);
    expect(r.draft).toEqual({ marketId: 'm-winner', outcome: 'home', amount: 5 * USDC });
    expect(r.text).toMatch(/Drafted \$5 on Portugal at 52%.*Confirm it in the app/);
  });

  it('parses number words, decimals and other phrasings', () => {
    expect(answerTalk('Bet twenty on no', ctx).draft).toEqual({ marketId: 'm-pen', outcome: 'no', amount: 20 * USDC });
    expect(answerTalk('$2.50 on yes please', ctx).draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 2_500_000 });
    expect(answerTalk("I'll take ten on Spain", ctx).draft).toEqual({ marketId: 'm-winner', outcome: 'away', amount: 10 * USDC });
    expect(answerTalk('put three dollars on the draw', ctx).draft).toEqual({ marketId: 'm-winner', outcome: 'draw', amount: 3 * USDC });
    expect(answerTalk('fifty cents on nope', ctx).draft).toEqual({ marketId: 'm-pen', outcome: 'no', amount: 500_000 });
  });

  it('uses keywords to pick between yes/no markets', () => {
    expect(answerTalk('put 5 on yes for the corners one', ctx).draft).toEqual({ marketId: 'm-corners', outcome: 'yes', amount: 5 * USDC });
    expect(answerTalk('put 4 on Portugal reaching seven corners', ctx).draft).toEqual({ marketId: 'm-corners', outcome: 'yes', amount: 4 * USDC });
    expect(answerTalk('bet 2 on Ronaldo scoring', ctx).draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 2 * USDC });
    expect(answerTalk('bet 2 on Ronaldo to miss', ctx).draft).toEqual({ marketId: 'm-pen', outcome: 'no', amount: 2 * USDC });
  });

  it('never drafts on a locked or resolved market', () => {
    const onlyLocked = talk({ markets: [lockedMarket, { ...penalty, state: 'resolved' }] });
    const r = answerTalk('put 5 on yes', onlyLocked);
    expect(r.draft).toBeUndefined();
    expect(r.text).toMatch(/Nothing's open to bet on/);
    expect(answerTalk('put 5 on yes for the red card', ctx).draft?.marketId).not.toBe('m-locked');
  });

  it('asks for what is missing instead of guessing', () => {
    const noAmount = answerTalk('put it on yes', ctx);
    expect(noAmount.draft).toBeUndefined();
    expect(noAmount.text).toMatch(/How much on Yes/);
    const noSide = answerTalk('bet 5', ctx);
    expect(noSide.draft).toBeUndefined();
    expect(noSide.text).toMatch(/Which side\?.*Yes at 77% or No at 23%/);
    expect(answerTalk('put zero on yes', ctx).draft).toBeUndefined();
  });

  it('refuses a draft larger than the speaker balance', () => {
    const r = answerTalk('put 50 on yes', ctx);
    expect(r.draft).toBeUndefined();
    expect(r.text).toBe("You've only got $20 available, Jake. Try a smaller number.");
    // The box has no speaker: the draft is still only a draft; the engine checks the balance on confirm.
    expect(answerTalk('put 50 on yes', talk({ speaker: undefined })).draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 50 * USDC });
  });

  it('drafts in points mode with the same base units', () => {
    const r = answerTalk('ten points on yes', talk({ points: true }));
    expect(r.draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 10 * USDC });
    expect(r.text).toContain('Drafted 10 pts on Yes');
  });
});

describe('answerTalk: room questions', () => {
  it('answers "who\'s winning?" from the leaderboard', () => {
    const r = answerTalk("Who's winning?", ctx);
    expect(r.intent).toBe('leaderboard');
    expect(r.text).toBe('Ayan leads, up $12. Then Priya, up $3; Jake, down $8. Ayan has won 3 in a row.');
    expect(answerTalk("who's losing", ctx).text).toContain('Jake is bringing up the rear, down $8.');
    expect(answerTalk("who's winning", talk({ leaderboard: [] })).text).toMatch(/Nobody is on the board/);
  });

  it('answers the score and clock', () => {
    expect(answerTalk("What's the score?", ctx).text).toBe("It's Portugal 2-1 Spain, 63' on the clock.");
    expect(answerTalk("what's the score", talk({ score: '', clock: '' })).text).toMatch(/don't have a score/);
  });

  it('answers balance, open markets and the last result', () => {
    expect(answerTalk('how much do I have?', ctx).text).toBe("Jake, you have $20 available and you're down $8 tonight.");
    expect(answerTalk('how much do I have?', talk({ speaker: undefined })).text).toMatch(/your own phone/);
    const open = answerTalk("what's open?", ctx).text;
    expect(open).toMatch(/^3 markets are open\./);
    expect(open).toContain('Will Ronaldo score this penalty? Yes at 77%.');
    expect(open).not.toContain('red card');
    expect(answerTalk('what happened on the last one?', ctx).text).toBe('Last one: Will Portugal score before half time? It was Yes.');
  });

  it('gives a short helpful reply to anything else', () => {
    const r = answerTalk('tell me a joke about cheese', ctx);
    expect(r.intent).toBe('unknown');
    expect(r.draft).toBeUndefined();
    expect(r.text).toMatch(/odds.*score.*who's winning.*five on yes/);
    expect(answerTalk('', ctx).text).toMatch(/didn't catch that/);
    expect(answerTalk('hey', ctx).text).toMatch(/^Hey, Jake!/);
  });

  it('never invents a number: every figure in a reply comes from the context', () => {
    const many: TalkContext = talk({ markets: [winner, corners, penalty, lockedMarket, market({ id: 'm-x', question: 'Will Spain score next?', price: { yes: 0.31, no: 0.69 } })] });
    const allowed = new Set(['77', '23', '61', '39', '52', '25', '46', '12', '88', '31', '69', '7', '12', '3', '8', '2', '1', '63', '20', '5', '4']);
    for (const q of ['odds on Spain scoring next', "who's winning", "what's the score", "what's open", 'put 5 on yes', 'odds on the red card']) {
      const text = answerTalk(q, many).text;
      for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) {
        // Payouts are derived from the price (1 / p), everything else must be a context number.
        const derived = /^\d\.\d\d$/.test(n) || n === '1';
        expect(derived || allowed.has(n), `${q} -> ${text} (${n})`).toBe(true);
      }
    }
  });
});

describe('announcer.answer', () => {
  const offline: LlmClient = { available: false, completeJson: async () => null };

  it('uses the rules with no keys at all', async () => {
    const a = createAnnouncer({}, offline, { log: silentLogger });
    const odds = await a.answer('what are the odds Portugal hits seven?', ctx);
    expect(odds).toEqual({ text: 'Will Portugal reach 7 corners? Yes is at 61%, $1 pays $1.64. No 39%.' });
    const bet = await a.answer('put 5 on yes for me', ctx);
    expect(bet.draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 5 * USDC });
    expect(bet.text).toMatch(/Confirm it in the app/);
  });

  it('lets the LLM rephrase but never touch the draft or the numbers', async () => {
    const good: LlmClient = {
      available: true,
      completeJson: vi.fn(async () => ({ text: "Jake, I've drafted $5 on Yes at 77% for the Ronaldo penalty. Confirm it in the app!" })),
    };
    const styled = await createAnnouncer({}, good, { log: silentLogger }).answer('put 5 on yes for me', ctx);
    expect(styled.text).toBe("Jake, I've drafted $5 on Yes at 77% for the Ronaldo penalty. Confirm it in the app!");
    expect(styled.draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 5 * USDC });

    // A rewrite that changes a number, drops the confirm step or pushes more betting is thrown away.
    for (const bad of [
      'Drafted $50 on Yes at 77%. Confirm it in the app!',
      'Done! $5 on Yes at 77% is placed.',
      'Drafted $5 on Yes at 77%. Confirm it in the app, then double down!',
      'Drafted on Yes. Confirm it in the app.',
    ]) {
      const llm: LlmClient = { available: true, completeJson: async () => ({ text: bad }) };
      const r = await createAnnouncer({}, llm, { log: silentLogger }).answer('put 5 on yes for me', ctx);
      expect(r.text, bad).toBe('Drafted $5 on Yes at 77%: Will Ronaldo score this penalty? Confirm it in the app, Jake.');
      expect(r.draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 5 * USDC });
    }
    expect(await rephraseReply(offline, 'x', ctx)).toBeNull();
  });
});
