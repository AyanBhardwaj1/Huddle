import { describe, expect, it } from 'vitest';
import { initialGameState, type GameEvent, type GameEventType, type GameState, type Market, type MarketCandidate } from '@huddle/shared';
import { MockLlmClient } from '@huddle/shared/mocks';
import { reduce } from '@huddle/sports';
import { HuddleQuestionEngine, TEMPLATES } from './engine';
import { createQuestionEngine, createQuestionRanker } from './index';
import { normalCdf, normalInv, normalizePrior, poissonAtLeast, poissonCdf, poissonMatch, poissonPmf, solvePoissonRates } from './math';
import { conversionProb, conversionTableRate, defaultNflStrength, driveResultProbs, NFL_TABLE, nflWinProb, passProb, periodWinnerProbs, redZoneProbs, totalMeanFromLine, totalOverProb } from './nfl';
import { cardBeforeHalfProb, cornerShotOnTargetProb, defaultGoalRates, goalRatesFromOdds, goalsAtLeastProb, matchProbs, nextGoalProbs, penaltyProb, pickGoalLine, remainingRates, SOCCER_TABLE } from './soccer';
import { marketFromCandidate } from './testkit';

const POR = { name: 'Portugal', short: 'POR' };
const ESP = { name: 'Spain', short: 'ESP' };
const DAL = { name: 'Dallas Cowboys', short: 'DAL' };
const TEN = { name: 'Tennessee Titans', short: 'TEN' };

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

/** Tiny game driver: builds events with increasing seq and keeps the reduced state. */
function game(sport: 'soccer' | 'nfl') {
  const home = sport === 'soccer' ? POR : DAL;
  const away = sport === 'soccer' ? ESP : TEN;
  let state: GameState = initialGameState('g1', sport, home, away);
  let seq = 0;
  const score = { home: 0, away: 0 };
  return {
    get state(): GameState {
      return state;
    },
    ev(type: GameEventType, extra: Partial<GameEvent> & { minute?: number; score?: { home: number; away: number } } = {}): GameEvent {
      seq += 1;
      if (extra.score) Object.assign(score, extra.score);
      const { minute, ...rest } = extra;
      const e: GameEvent = {
        gameId: 'g1',
        sport,
        seq,
        ts: new Date(1_800_000_000_000 + seq * 1000).toISOString(),
        clock: { period: 1, display: sport === 'soccer' ? `${minute ?? 0}'` : '15:00' },
        type,
        ...rest,
        data: { ...(sport === 'soccer' ? { minute: minute ?? state.minute ?? 0 } : {}), ...(rest.data ?? {}) },
        score: { ...score },
      };
      state = reduce(state, e);
      return e;
    },
  };
}

function one(cands: MarketCandidate[], templateId: string): MarketCandidate {
  const c = cands.find((x) => x.templateId === templateId);
  if (!c) throw new Error(`no ${templateId} in [${cands.map((x) => x.templateId).join(', ')}]`);
  return c;
}

describe('math', () => {
  it('Poisson and normal helpers behave', () => {
    expect(poissonPmf(0, 1.35)).toBeCloseTo(Math.exp(-1.35), 10);
    expect(poissonCdf(50, 2.45)).toBeCloseTo(1, 9);
    expect(poissonAtLeast(0, 1)).toBe(1);
    expect(poissonAtLeast(2, 1.35)).toBeCloseTo(1 - Math.exp(-1.35) * 2.35, 9);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    for (const p of [0.01, 0.2, 0.5, 0.795, 0.99]) expect(normalCdf(normalInv(p))).toBeCloseTo(p, 4);
    const m = poissonMatch(1.35, 1.1);
    expect(m.home + m.draw + m.away).toBeCloseTo(1, 9);
    expect(m.home).toBeGreaterThan(m.away);
  });

  it('solves the Poisson rates back from win/draw/loss odds, even with a bookmaker margin', () => {
    const truth = poissonMatch(1.8, 0.9);
    const solved = solvePoissonRates(truth.home, truth.draw, truth.away);
    expect(solved.home).toBeCloseTo(1.8, 1);
    expect(solved.away).toBeCloseTo(0.9, 1);
    const withMargin = solvePoissonRates(truth.home * 1.06, truth.draw * 1.06, truth.away * 1.06);
    expect(withMargin.home).toBeCloseTo(solved.home, 2);
    const rates = goalRatesFromOdds(0.25, 0.25, 0.5);
    expect(rates.away).toBeGreaterThan(rates.home);
    expect(rates.source).toBe('odds');
  });

  it('normalizePrior always returns a proper distribution', () => {
    for (const raw of [{ a: 0.7, b: 0.3 }, { a: 0.999, b: 0.001 }, { a: 5, b: 3, c: 2 }, { a: 0, b: 0 }, { a: Number.NaN, b: 0.4 }, { a: 0.33333, b: 0.33333, c: 0.33333 }]) {
      const p = normalizePrior(raw);
      expect(sum(p)).toBeCloseTo(1, 9);
      for (const v of Object.values(p)) {
        expect(v).toBeGreaterThanOrEqual(0.02 - 1e-9);
        expect(v).toBeLessThanOrEqual(0.98 + 1e-9);
      }
    }
    expect(normalizePrior({ a: 0.999, b: 0.001 })).toEqual({ a: 0.98, b: 0.02 });
    expect(normalizePrior({})).toEqual({});
  });
});

describe('soccer pricing', () => {
  it('penalty: base rate from the data, shrunk toward the taker with k = 20', () => {
    const t = SOCCER_TABLE.penalty;
    expect(t.shrinkage_k).toBe(20);
    // The measured base rate (StatsBomb open data) sits in the usual 70 to 80% band.
    expect(t.base_rate).toBeGreaterThan(0.7);
    expect(t.base_rate).toBeLessThan(0.8);
    const unknown = penaltyProb('Some Unknown Player');
    expect(unknown.p).toBe(t.base_rate);
    expect(unknown.taker).toBeUndefined();
    expect(penaltyProb(undefined).p).toBe(t.base_rate);

    const cr = penaltyProb('Ronaldo');
    expect(cr.taker).toMatchObject({ from: 'career' });
    expect(cr.p).toBeCloseTo((cr.taker!.scored + 20 * t.base_rate) / (cr.taker!.attempts + 20), 9);
    expect(cr.p).toBeGreaterThan(t.base_rate);
    expect(cr.p).toBeLessThan(cr.taker!.rate);
    expect(penaltyProb('Cristiano Ronaldo').p).toBe(cr.p);

    // A small sample barely moves the price: 3 from 3 does not mean 100%.
    const custom = { ...SOCCER_TABLE, penalty: { ...t, career: { Rookie: { attempts: 3, scored: 3 } }, takers_in_sample: {} } };
    const rookie = penaltyProb('Rookie', custom);
    expect(rookie.p).toBeCloseTo((3 + 20 * t.base_rate) / 23, 9);
    expect(rookie.p).toBeLessThan(0.82);
  });

  it('goals: defaults, N+ goals fall as N rises, time decay, next goal sums to 1', () => {
    const rates = defaultGoalRates();
    expect(rates).toMatchObject({ home: 1.35, away: 1.1, source: 'default' });
    const p1 = goalsAtLeastProb(1, 0, rates.home);
    const p2 = goalsAtLeastProb(2, 0, rates.home);
    const p3 = goalsAtLeastProb(3, 0, rates.home);
    expect(p1).toBeGreaterThan(p2);
    expect(p2).toBeGreaterThan(p3);
    expect(p2).toBeCloseTo(1 - Math.exp(-1.35) * 2.35, 9);
    // Already scored one: needing one more is easier than needing two from scratch.
    expect(goalsAtLeastProb(2, 1, rates.home)).toBeGreaterThan(p2);
    expect(goalsAtLeastProb(2, 2, 0)).toBe(1);

    const late = remainingRates(rates, 80);
    expect(late.home).toBeCloseTo((1.35 * 10) / 90, 9);
    expect(remainingRates(rates, 95).home).toBe(0);
    expect(goalsAtLeastProb(2, 0, late.home)).toBeLessThan(p2);

    const mid = remainingRates(rates, 60);
    const ng = nextGoalProbs(mid.home, mid.away);
    expect(ng.home + ng.away + ng.none).toBeCloseTo(1, 9);
    expect(ng.none).toBeCloseTo(Math.exp(-(mid.home + mid.away)), 9);
    expect(ng.home / ng.away).toBeCloseTo(1.35 / 1.1, 6);
    expect(nextGoalProbs(0, 0)).toEqual({ home: 0, away: 0, none: 1 });

    const lead = matchProbs(late.home, late.away, 1);
    expect(lead.home).toBeGreaterThan(0.8);
    expect(pickGoalLine(1.35)).toMatchObject({ n: 2 });
    expect(pickGoalLine(2.45)).toMatchObject({ n: 3 });
    expect(pickGoalLine(3.2).p).toBeGreaterThanOrEqual(0.25);
    expect(pickGoalLine(3.2).p).toBeLessThanOrEqual(0.6);
  });

  it('cards and corners come from the table', () => {
    expect(cardBeforeHalfProb(10)).toBeGreaterThan(cardBeforeHalfProb(40));
    expect(cardBeforeHalfProb(47)).toBeCloseTo(0, 6);
    expect(cornerShotOnTargetProb()).toBe(SOCCER_TABLE.corner.shot_on_target_rate);
    expect(cornerShotOnTargetProb()).toBeGreaterThan(0.03);
    expect(cornerShotOnTargetProb()).toBeLessThan(0.3);
  });
});

describe('NFL pricing', () => {
  it('conversion falls with distance, in the table and in the trained model', () => {
    const at = (down: number, distance: number): number => conversionProb({ down, distance, yardline: 50, scoreDiff: 0, secondsRemaining: 1800, goForIt: true }).p;
    expect(conversionTableRate(3, 1).p).toBeGreaterThan(conversionTableRate(3, 10).p);
    expect(at(3, 1)).toBeGreaterThan(at(3, 10));
    let prev = 1;
    for (const d of [1, 2, 3, 5, 8, 12, 20]) {
      expect(at(3, d)).toBeLessThan(prev);
      prev = at(3, d);
    }
    expect(at(3, 1)).toBeGreaterThan(0.6);
    expect(at(3, 10)).toBeLessThan(0.4);
    expect(at(3, 20)).toBeGreaterThan(0.02);
  });

  it('4th down multiplies by the go-for-it rate unless the feed says they are going', () => {
    const base = { down: 4, distance: 2, yardline: 30, scoreDiff: 0, secondsRemaining: 1800 };
    const unknown = conversionProb(base);
    const going = conversionProb({ ...base, goForIt: true });
    expect(going.goRate).toBe(1);
    expect(unknown.goRate).toBeLessThan(0.3); // deep in their own half, they punt
    expect(unknown.p).toBeCloseTo(unknown.playRate * unknown.goRate, 9);
    expect(unknown.p).toBeLessThan(going.p);
    // The lookup table still works when the JSON has no trained model.
    const tableOnly = conversionProb({ ...base, down: 3 }, { ...NFL_TABLE, logit_conversion: undefined });
    expect(tableOnly).toMatchObject({ model: 'table' });
    expect(tableOnly.p).toBe(conversionTableRate(3, 2).p);
  });

  it('drive results sum to 1 and improve with field position', () => {
    const own10 = driveResultProbs({ yardline: 10, scoreDiff: 0, secondsRemaining: 1800 });
    const opp30 = driveResultProbs({ yardline: 70, scoreDiff: 0, secondsRemaining: 1800 });
    for (const d of [own10, opp30]) expect(d.td + d.fg + d.none).toBeCloseTo(1, 6);
    expect(opp30.td).toBeGreaterThan(own10.td);
    expect(opp30.none).toBeLessThan(own10.none);
    const table = driveResultProbs({ yardline: 25 }, { ...NFL_TABLE, multinomial_drive: undefined });
    expect(table).toMatchObject({ model: 'table', bucket: 'own_21_30' });
    expect(table.td + table.fg + table.none).toBeCloseTo(1, 3);
    expect(redZoneProbs(97).td).toBeGreaterThan(redZoneProbs(82).td);
    expect(redZoneProbs(82).td).toBeGreaterThan(0.4);
  });

  it('pass rate rises with distance; totals and win probability move with score and clock', () => {
    const pass = (down: number, distance: number): number => passProb({ down, distance, yardline: 40, scoreDiff: 0, secondsRemaining: 1800 }).p;
    expect(pass(3, 10)).toBeGreaterThan(pass(3, 1));
    expect(pass(2, 10)).toBeGreaterThan(pass(1, 10));

    const s = defaultNflStrength();
    expect(s.totalLine % 1).toBe(0.5);
    expect(totalOverProb(s, s.totalLine, 0, 3600)).toBeGreaterThan(0.4);
    expect(totalOverProb(s, s.totalLine, 0, 3600)).toBeLessThan(0.6);
    expect(totalOverProb(s, 44.5, 45, 600)).toBe(1);
    expect(totalOverProb(s, 44.5, 10, 0)).toBe(0);
    expect(totalOverProb(s, 44.5, 23, 900)).toBeLessThan(0.3);
    expect(totalOverProb(s, 54.5, 0, 3600)).toBeLessThan(totalOverProb(s, 38.5, 0, 3600));
    expect(totalOverProb({ ...s, totalMean: totalMeanFromLine(53.5, 0.5) }, 53.5, 0, 3600)).toBeCloseTo(0.5, 3);

    expect(nflWinProb(s, 0, 3600)).toBeCloseTo(s.pHome, 3);
    expect(nflWinProb(s, 14, 600)).toBeGreaterThan(0.95);
    expect(nflWinProb(s, -3, 0)).toBe(0);
    expect(nflWinProb({ ...s, pHome: 0.8 }, 0, 3600)).toBeCloseTo(0.8, 3);

    for (const key of ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2'] as const) {
      const p = periodWinnerProbs(key, s);
      expect(p.home + p.tie + p.away).toBeCloseTo(1, 9);
      expect(p.home).toBeCloseTo(NFL_TABLE.period_winner[key]!.home, 3);
    }
    expect(periodWinnerProbs('H1', s).tie).toBeLessThan(periodWinnerProbs('Q1', s).tie);
  });
});

describe('trigger rules', () => {
  it('never proposes the same template twice while one is open, and never on catch-up or final', () => {
    const engine = new HuddleQuestionEngine();
    const g = game('soccer');
    const kickoff = g.ev('kickoff', { team: 'POR' });
    const first = engine.propose(kickoff, g.state, []);
    expect(first.map((c) => c.templateId)).toEqual([TEMPLATES.soccerWinner, TEMPLATES.soccerTeamGoals, TEMPLATES.soccerTotalGoals]); // by priority
    const open = first.slice(0, 2).map((c, i) => marketFromCandidate(c, { id: `m${i}`, seq: kickoff.seq }));
    expect(engine.propose(kickoff, g.state, open).map((c) => c.templateId)).toEqual([TEMPLATES.soccerTotalGoals]);
    // A finished market no longer blocks its template.
    open[0]!.state = 'final';
    expect(engine.propose(kickoff, g.state, open).map((c) => c.templateId)).toEqual([TEMPLATES.soccerWinner, TEMPLATES.soccerTotalGoals]);

    const pen = g.ev('penalty_awarded', { team: 'POR', player: 'Ronaldo', minute: 8 });
    const penMarket = marketFromCandidate(one(engine.propose(pen, g.state, []), TEMPLATES.soccerPenalty), { id: 'p', seq: pen.seq });
    penMarket.state = 'locked';
    expect(engine.propose(pen, g.state, [penMarket])).toEqual([]);
    expect(engine.propose({ ...pen, data: { ...pen.data, catchUp: true } }, g.state, [])).toEqual([]);

    const final = g.ev('final', { minute: 90 });
    expect(engine.propose(final, g.state, [])).toEqual([]);
    expect(engine.propose(pen, g.state, [])).toEqual([]); // state is final
  });

  it('soccer: card rule only before halftime, corner rule only on the award, next goal once at 60', () => {
    const engine = new HuddleQuestionEngine();
    const g = game('soccer');
    g.ev('kickoff');
    expect(engine.propose(g.ev('card', { team: 'ESP', player: 'Rodri', minute: 15, data: { color: 'yellow' } }), g.state, []).map((c) => c.templateId)).toEqual([TEMPLATES.soccerCard]);
    expect(engine.propose(g.ev('card', { team: 'ESP', minute: 43, data: { color: 'yellow' } }), g.state, [])).toEqual([]);
    expect(engine.propose(g.ev('corner', { team: 'POR', minute: 44 }), g.state, []).map((c) => c.templateId)).toEqual([TEMPLATES.soccerCorner]);
    expect(engine.propose(g.ev('corner', { team: 'POR', minute: 44, data: { shotOnTarget: true } }), g.state, [])).toEqual([]);
    g.ev('period_end', { minute: 45, data: { period: 1 } });
    const second = { period: 2, display: "46'" };
    expect(engine.propose(g.ev('period_start', { minute: 45, clock: second, data: { period: 2 } }), g.state, []).map((c) => c.templateId)).toEqual([TEMPLATES.periodWinner]);
    expect(engine.propose(g.ev('card', { team: 'POR', minute: 55, clock: second, data: { color: 'yellow' } }), g.state, [])).toEqual([]);
    expect(engine.propose(g.ev('score_update', { minute: 59, clock: second }), g.state, [])).toEqual([]);
    const at60 = engine.propose(g.ev('sub', { team: 'POR', minute: 61, clock: second }), g.state, []);
    expect(at60.map((c) => c.templateId)).toEqual([TEMPLATES.soccerNextGoal]);
    expect(at60[0]!.lockOnEvent).toBe('goal|minute:85');
    expect(engine.propose(g.ev('score_update', { minute: 63, clock: second }), g.state, [])).toEqual([]); // one shot
    // A rewind (seq restarts) re-arms the one-shot rule.
    const again = { ...g.ev('score_update', { minute: 64, clock: second }), seq: 2 };
    expect(engine.propose(again, g.state, []).map((c) => c.templateId)).toEqual([TEMPLATES.soccerNextGoal]);
  });

  it('NFL: run-or-pass on early downs, conversions on 3rd, 4th down only when an attempt is plausible', () => {
    const engine = new HuddleQuestionEngine();
    const g = game('nfl');
    g.ev('kickoff', { data: { secondsRemaining: 3600 } });
    const drive = engine.propose(g.ev('drive_start', { team: 'DAL', data: { yardline: 25, secondsRemaining: 3600 } }), g.state, []);
    expect(drive.map((c) => c.templateId)).toEqual([TEMPLATES.nflDrive]);

    const snap = (down: number, distance: number, yardline: number, extra: Record<string, unknown> = {}): MarketCandidate[] =>
      engine.propose(g.ev('snap', { team: 'DAL', data: { down, distance, yardline, secondsRemaining: 3000, ...extra } }), g.state, []);

    const first = snap(1, 10, 25);
    expect(first.map((c) => c.templateId)).toEqual([TEMPLATES.nflRunPass]);
    expect(first[0]!.question).toBe('Run or pass on 1st & 10?');
    expect(first[0]!.outcomes.map((o) => o.id)).toEqual(['run', 'pass']);
    expect(sum(first[0]!.prior)).toBeCloseTo(1, 9);
    expect(first[0]!.priority).toBeLessThan(drive[0]!.priority);

    const third = snap(3, 7, 40);
    expect(third.map((c) => c.templateId)).toEqual([TEMPLATES.nflConversion]);
    expect(third[0]!.question).toBe('Do the Cowboys convert on 3rd & 7?');
    expect(snap(3, 4, 96)[0]!.question).toBe('Do the Cowboys convert on 3rd & goal?');

    expect(snap(4, 8, 30)).toEqual([]); // they will punt
    expect(snap(4, 1, 30, { punt: true })).toEqual([]);
    const fourthShort = snap(4, 1, 60);
    expect(fourthShort.map((c) => c.templateId)).toEqual([TEMPLATES.nflConversion]);
    expect(fourthShort[0]!.rationale).toMatch(/only go for it/);
    const going = snap(4, 8, 30, { goForIt: true });
    expect(going.map((c) => c.templateId)).toEqual([TEMPLATES.nflConversion]);
    expect(going[0]!.priority).toBeGreaterThan(third[0]!.priority - 6);

    // A drive that starts inside the 20 (after a turnover) gets the red-zone question as well.
    const short = engine.propose(g.ev('drive_start', { team: 'TEN', data: { yardline: 88, secondsRemaining: 2000 } }), g.state, []);
    expect(short.map((c) => c.templateId)).toEqual([TEMPLATES.nflRedZone, TEMPLATES.nflDrive]);
  });
});

describe('lock rules', () => {
  const engine = new HuddleQuestionEngine();
  const base = (lockOnEvent: string | undefined, seq = 1): Market => {
    const m = marketFromCandidate({ templateId: 't', kind: 'game', question: 'q', hook: 'h', outcomes: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], prior: { yes: 0.5, no: 0.5 }, resolver: { type: 'x', params: {} }, priority: 1, lockOnEvent }, { id: 'm', seq });
    return m;
  };

  it('understands event types, qualifiers, alternatives and the final whistle', () => {
    const g = game('soccer');
    g.ev('kickoff');
    const goal = g.ev('goal', { team: 'POR', minute: 20, score: { home: 1, away: 0 } });
    expect(engine.shouldLock(base('goal'), goal, g.state)).toBe(true);
    expect(engine.shouldLock(base('penalty_result'), goal, g.state)).toBe(false);
    expect(engine.shouldLock(base('goal|minute:85'), goal, g.state)).toBe(true);
    expect(engine.shouldLock(base('minute:80'), goal, g.state)).toBe(false);
    expect(engine.shouldLock(base(undefined), goal, g.state)).toBe(false);
    // Never from the creating event or anything before it.
    expect(engine.shouldLock(base('goal', goal.seq), goal, g.state)).toBe(false);

    const half = g.ev('period_end', { minute: 45, data: { period: 1 } });
    expect(engine.shouldLock(base('period_end:1'), half, g.state)).toBe(true);
    expect(engine.shouldLock(base('period_end:2'), half, g.state)).toBe(false);
    expect(engine.shouldLock(base('card|period_end:1'), half, g.state)).toBe(true);

    const eighty = g.ev('score_update', { minute: 80, clock: { period: 2, display: "80'" } });
    expect(engine.shouldLock(base('minute:80'), eighty, g.state)).toBe(true);
    expect(engine.shouldLock(base('goal|minute:85'), eighty, g.state)).toBe(false);
    // A later period end also locks a market that was waiting for an earlier one.
    const full = g.ev('period_end', { minute: 90, clock: { period: 2, display: "90'" }, data: { period: 2 } });
    expect(engine.shouldLock(base('period_end:1'), full, g.state)).toBe(true);

    const final = g.ev('final', { minute: 90 });
    expect(engine.shouldLock(base('snap'), final, g.state)).toBe(true);
    expect(engine.shouldLock(base(undefined), final, g.state)).toBe(true);
  });
});

describe('resolvers', () => {
  const engine = new HuddleQuestionEngine();
  const yesNo = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
  const mk = (type: string, params: Record<string, unknown>, outcomes = yesNo, seq = 1): Market =>
    marketFromCandidate({ templateId: 't', kind: 'moment', question: 'q', hook: 'h', outcomes, prior: normalizePrior(Object.fromEntries(outcomes.map((o) => [o.id, 1]))), resolver: { type, params }, priority: 1 }, { id: 'm', seq });

  it('never resolves from the creating event or anything before it', () => {
    const g = game('soccer');
    g.ev('kickoff');
    const result = g.ev('penalty_result', { team: 'POR', data: { scored: true } });
    expect(engine.evaluate(mk('penalty_result', { team: 'POR' }, yesNo, result.seq), result, g.state)).toBeNull();
    expect(engine.evaluate(mk('penalty_result', { team: 'POR' }, yesNo, result.seq + 5), result, g.state)).toBeNull();
    expect(engine.evaluate(mk('penalty_result', { team: 'POR' }, yesNo, result.seq - 1), result, g.state)).toEqual({ outcome: 'yes' });
    const goal = g.ev('goal', { team: 'POR', score: { home: 3, away: 0 } });
    expect(engine.evaluate(mk('total_goals', { n: 2 }, yesNo, goal.seq), goal, g.state)).toBeNull();
  });

  it('penalty_result: scored, missed, ambiguous, never arrived', () => {
    const g = game('soccer');
    g.ev('kickoff');
    const m = mk('penalty_result', { team: 'POR', player: 'Ronaldo' });
    expect(engine.evaluate(m, g.ev('score_update', { minute: 9 }), g.state)).toBeNull();
    expect(engine.evaluate(m, g.ev('penalty_result', { team: 'ESP', data: { scored: true } }), g.state)).toBeNull(); // other team's penalty
    expect(engine.evaluate(m, g.ev('penalty_result', { team: 'POR', data: { scored: false } }), g.state)).toEqual({ outcome: 'no' });
    expect(engine.evaluate(m, g.ev('penalty_result', { team: 'POR', data: {} }), g.state)).toEqual({ void: true, reason: 'penalty result was ambiguous in the feed' });
    expect(engine.evaluate(m, g.ev('period_end', { data: { period: 1 } }), g.state)).toMatchObject({ void: true });
    expect(engine.evaluate(m, g.ev('final'), g.state)).toMatchObject({ void: true, reason: expect.stringMatching(/no penalty result/) });
  });

  it('total_goals, next_goal, corner_outcome and card_count', () => {
    const g = game('soccer');
    g.ev('kickoff');
    const teamGoals = mk('total_goals', { n: 2, side: 'home' });
    const total = mk('total_goals', { n: 3 });
    const g1 = g.ev('goal', { team: 'POR', minute: 10, score: { home: 1, away: 0 } });
    expect(engine.evaluate(teamGoals, g1, g.state)).toBeNull();
    const g2 = g.ev('goal', { team: 'ESP', minute: 20, score: { home: 1, away: 1 } });
    expect(engine.evaluate(teamGoals, g2, g.state)).toBeNull();
    expect(engine.evaluate(total, g2, g.state)).toBeNull();
    const g3 = g.ev('goal', { team: 'ESP', minute: 30, score: { home: 1, away: 2 } });
    expect(engine.evaluate(total, g3, g.state)).toEqual({ outcome: 'yes' });
    expect(engine.evaluate(teamGoals, g3, g.state)).toBeNull();
    expect(engine.evaluate(mk('total_goals', {}), g3, g.state)).toMatchObject({ void: true });

    const next = mk('next_goal', { startHome: 1, startAway: 2 }, [{ id: 'home', label: 'Portugal' }, { id: 'away', label: 'Spain' }, { id: 'none', label: 'None' }]);
    expect(engine.evaluate(next, g.ev('card', { team: 'POR', minute: 61, data: { color: 'yellow' } }), g.state)).toBeNull();
    expect(engine.evaluate(next, g.ev('goal', { team: 'POR', minute: 70, score: { home: 2, away: 2 } }), g.state)).toEqual({ outcome: 'home' });
    // A missed goal event still resolves from the scoreboard; two goals at once is ambiguous.
    expect(engine.evaluate(next, g.ev('score_update', { minute: 75, score: { home: 2, away: 3 } }), g.state)).toMatchObject({ void: true });
    const quiet = mk('next_goal', { startHome: 2, startAway: 3 }, next.outcomes);
    expect(engine.evaluate(quiet, g.ev('score_update', { minute: 80 }), g.state)).toBeNull();

    const corner = mk('corner_outcome', { team: 'POR' });
    expect(engine.evaluate(corner, g.ev('corner', { team: 'ESP', data: { shotOnTarget: true } }), g.state)).toBeNull(); // someone else's corner outcome
    expect(engine.evaluate(corner, g.ev('corner', { team: 'POR', data: { shotOnTarget: false } }), g.state)).toEqual({ outcome: 'no' });
    expect(engine.evaluate(corner, g.ev('corner', { team: 'POR', data: { shotOnTarget: true } }), g.state)).toEqual({ outcome: 'yes' });
    expect(engine.evaluate(corner, g.ev('goal', { team: 'POR', score: { home: 3, away: 3 } }), g.state)).toEqual({ outcome: 'yes' });
    expect(engine.evaluate(corner, g.ev('corner', { team: 'ESP' }), g.state)).toMatchObject({ void: true, reason: expect.stringMatching(/new corner/) });

    const final = g.ev('final', { minute: 90 });
    expect(engine.evaluate(quiet, final, g.state)).toEqual({ outcome: 'none' });
    expect(engine.evaluate(teamGoals, final, g.state)).toEqual({ outcome: 'yes' });
    expect(engine.evaluate(mk('total_goals', { n: 9 }), final, g.state)).toEqual({ outcome: 'no' });
    expect(engine.evaluate(corner, final, g.state)).toMatchObject({ void: true });

    const h = game('soccer');
    h.ev('kickoff');
    const card = mk('card_count', { period: 1 });
    expect(engine.evaluate(card, h.ev('goal', { team: 'POR', minute: 30, score: { home: 1, away: 0 } }), h.state)).toBeNull();
    expect(engine.evaluate(card, h.ev('card', { team: 'POR', minute: 31, data: { color: 'red' } }), h.state)).toEqual({ outcome: 'yes' });
    expect(engine.evaluate(card, h.ev('period_end', { minute: 45, data: { period: 1 } }), h.state)).toEqual({ outcome: 'no' });
    // A second-half card does not count for a first-half market.
    expect(engine.evaluate(card, h.ev('card', { team: 'POR', minute: 50, clock: { period: 2, display: "50'" }, data: { color: 'yellow' } }), h.state)).toEqual({ outcome: 'no' });
  });

  it('first_down_result, play_type and drive_result', () => {
    const g = game('nfl');
    g.ev('kickoff');
    g.ev('drive_start', { team: 'DAL', data: { yardline: 25 } });
    const conv = mk('first_down_result', { team: 'DAL', down: 3, distance: 3 });
    const runPass = mk('play_type', { team: 'DAL' }, [{ id: 'run', label: 'Run' }, { id: 'pass', label: 'Pass' }]);
    const drive = mk('drive_result', { team: 'DAL', startHome: 0, startAway: 0 }, [{ id: 'td', label: 'TD' }, { id: 'fg', label: 'FG' }, { id: 'none', label: 'None' }]);
    const redZone = mk('drive_result', { team: 'DAL', binary: true, startHome: 0, startAway: 0 });

    expect(engine.evaluate(conv, g.ev('snap', { team: 'DAL', data: { down: 3, distance: 3, yardline: 32 } }), g.state)).toBeNull();
    const flag = g.ev('play_result', { team: 'DAL', data: { down: 3, distance: 3, yardline: 32, noPlay: true } });
    expect(engine.evaluate(conv, flag, g.state)).toMatchObject({ void: true, reason: expect.stringMatching(/penalty/) });
    expect(engine.evaluate(runPass, flag, g.state)).toMatchObject({ void: true });
    expect(engine.evaluate(drive, flag, g.state)).toBeNull();

    const short = g.ev('play_result', { team: 'DAL', data: { down: 3, distance: 3, yardline: 32, playType: 'run', gained: 1, firstDown: false } });
    expect(engine.evaluate(conv, short, g.state)).toEqual({ outcome: 'no' });
    expect(engine.evaluate(runPass, short, g.state)).toEqual({ outcome: 'run' });
    expect(engine.evaluate(drive, short, g.state)).toBeNull();

    const punt = g.ev('play_result', { team: 'DAL', data: { down: 4, distance: 2, yardline: 33, playType: 'punt', gained: 0, firstDown: false } });
    expect(engine.evaluate(runPass, punt, g.state)).toMatchObject({ void: true, reason: expect.stringMatching(/punt/) });
    expect(engine.evaluate(drive, punt, g.state)).toEqual({ outcome: 'none' });
    expect(engine.evaluate(redZone, punt, g.state)).toEqual({ outcome: 'no' });

    const first = g.ev('play_result', { team: 'DAL', data: { down: 3, distance: 3, yardline: 32, playType: 'pass', gained: 9, firstDown: true } });
    expect(engine.evaluate(conv, first, g.state)).toEqual({ outcome: 'yes' });
    expect(engine.evaluate(runPass, first, g.state)).toEqual({ outcome: 'pass' });

    const td = g.ev('play_result', { team: 'DAL', data: { down: 3, distance: 6, yardline: 94, playType: 'pass', gained: 6, firstDown: false, touchdown: true }, score: { home: 6, away: 0 } });
    expect(engine.evaluate(conv, td, g.state)).toEqual({ outcome: 'yes' }); // a touchdown converts
    expect(engine.evaluate(drive, td, g.state)).toEqual({ outcome: 'td' });
    expect(engine.evaluate(redZone, td, g.state)).toEqual({ outcome: 'yes' });

    const pick = g.ev('play_result', { team: 'DAL', data: { down: 2, distance: 5, yardline: 60, playType: 'pass', gained: 0, firstDown: false, turnover: true, touchdown: true } });
    expect(engine.evaluate(drive, pick, g.state)).toEqual({ outcome: 'none' }); // pick-six is not the offense's touchdown
    expect(engine.evaluate(conv, pick, g.state)).toEqual({ outcome: 'no' });

    const miss = g.ev('play_result', { team: 'DAL', data: { down: 4, distance: 5, yardline: 70, playType: 'kick', gained: 0, firstDown: false, good: false } });
    expect(engine.evaluate(drive, miss, g.state)).toEqual({ outcome: 'none' });
    const good = g.ev('play_result', { team: 'DAL', data: { down: 4, distance: 5, yardline: 70, playType: 'kick', gained: 0, firstDown: false, good: true } });
    expect(engine.evaluate(drive, good, g.state)).toEqual({ outcome: 'fg' });
    expect(engine.evaluate(redZone, good, g.state)).toEqual({ outcome: 'no' });

    // The other team's plays are ignored; their drive_start means ours ended, read from the scoreboard.
    expect(engine.evaluate(drive, g.ev('play_result', { team: 'TEN', data: { playType: 'run', touchdown: true } }), g.state)).toBeNull();
    expect(engine.evaluate(drive, g.ev('drive_end', { team: 'DAL', data: { result: 'Touchdown' } }), g.state)).toEqual({ outcome: 'td' });
    expect(engine.evaluate(drive, g.ev('drive_end', { team: 'DAL', data: { result: 'downs' } }), g.state)).toEqual({ outcome: 'none' });
    const fromBoard = mk('drive_result', { team: 'DAL', startHome: 3, startAway: 0 }, drive.outcomes);
    expect(engine.evaluate(fromBoard, g.ev('drive_start', { team: 'TEN', data: { yardline: 25 } }), g.state)).toEqual({ outcome: 'fg' });
    expect(engine.evaluate(conv, g.ev('drive_start', { team: 'TEN', data: { yardline: 25 } }), g.state)).toMatchObject({ void: true });
    expect(engine.evaluate(conv, g.ev('final'), g.state)).toMatchObject({ void: true });
  });

  it('total_points, period_winner, match_winner and unknown resolvers', () => {
    const g = game('nfl');
    g.ev('kickoff');
    const total = mk('total_points', { line: 9.5 }, [{ id: 'over', label: 'Over' }, { id: 'under', label: 'Under' }]);
    const q1 = mk('period_winner', { periods: [1], startHome: 0, startAway: 0 }, [{ id: 'home', label: 'DAL' }, { id: 'tie', label: 'Tie' }, { id: 'away', label: 'TEN' }]);
    const twoWay = mk('match_winner', {}, [{ id: 'home', label: 'DAL' }, { id: 'away', label: 'TEN' }]);
    const unknown = mk('coin_toss', {});

    const fg = g.ev('score_update', { team: 'DAL', score: { home: 3, away: 0 } });
    expect(engine.evaluate(total, fg, g.state)).toBeNull();
    expect(engine.evaluate(q1, fg, g.state)).toBeNull();
    expect(engine.evaluate(unknown, fg, g.state)).toBeNull();
    const endQ1 = g.ev('period_end', { data: { period: 1 } });
    expect(engine.evaluate(q1, endQ1, g.state)).toEqual({ outcome: 'home' });
    expect(engine.evaluate(twoWay, endQ1, g.state)).toBeNull();

    const q2 = mk('period_winner', { periods: [2], startHome: 3, startAway: 0 }, q1.outcomes);
    const half2 = mk('period_winner', { periods: [3, 4], startHome: 3, startAway: 0 }, q1.outcomes);
    const endQ2 = g.ev('period_end', { clock: { period: 2, display: '0:00' }, data: { period: 2 } });
    expect(engine.evaluate(q2, endQ2, g.state)).toEqual({ outcome: 'tie' });
    expect(engine.evaluate(half2, endQ2, g.state)).toBeNull();
    const td = g.ev('score_update', { team: 'TEN', clock: { period: 3, display: '9:00' }, score: { home: 3, away: 7 } });
    expect(engine.evaluate(total, td, g.state)).toEqual({ outcome: 'over' });
    expect(engine.evaluate(half2, g.ev('period_end', { clock: { period: 3, display: '0:00' }, data: { period: 3 } }), g.state)).toBeNull();
    const endQ4 = g.ev('period_end', { clock: { period: 4, display: '0:00' }, data: { period: 4 } });
    expect(engine.evaluate(half2, endQ4, g.state)).toEqual({ outcome: 'away' });

    const final = g.ev('final');
    expect(engine.evaluate(twoWay, final, g.state)).toEqual({ outcome: 'away' });
    expect(engine.evaluate(mk('total_points', { line: 44.5 }, total.outcomes), final, g.state)).toEqual({ outcome: 'under' });
    expect(engine.evaluate(mk('total_points', { line: 10 }, total.outcomes), final, g.state)).toMatchObject({ void: true, reason: expect.stringMatching(/exactly on the line/) });
    expect(engine.evaluate(unknown, final, g.state)).toEqual({ void: true, reason: 'unknown resolver "coin_toss"' });

    // A level NFL game voids a two-way winner market; a soccer draw is a real outcome.
    const tied = game('nfl');
    tied.ev('kickoff');
    expect(engine.evaluate(twoWay, tied.ev('final'), tied.state)).toMatchObject({ void: true, reason: expect.stringMatching(/level/) });
    const s = game('soccer');
    s.ev('kickoff');
    const threeWay = mk('match_winner', {}, [{ id: 'home', label: 'POR' }, { id: 'draw', label: 'Draw' }, { id: 'away', label: 'ESP' }]);
    expect(engine.evaluate(threeWay, s.ev('final', { minute: 90 }), s.state)).toEqual({ outcome: 'draw' });
  });
});

describe('reprice and explain', () => {
  it('reprices game-long soccer markets as goals and minutes go by', () => {
    const engine = new HuddleQuestionEngine();
    const g = game('soccer');
    const kickoff = g.ev('kickoff', { team: 'POR' });
    const cands = engine.propose(kickoff, g.state, []);
    const winner = marketFromCandidate(one(cands, TEMPLATES.soccerWinner), { id: 'w', seq: 1 });
    const teamGoals = marketFromCandidate(one(cands, TEMPLATES.soccerTeamGoals), { id: 't', seq: 1 });
    const start = engine.reprice(winner, g.state)!;
    expect(start.home).toBeCloseTo(winner.prior.home!, 3);
    expect(sum(start)).toBeCloseTo(1, 6);

    g.ev('goal', { team: 'POR', minute: 30, score: { home: 1, away: 0 } });
    const ahead = engine.reprice(winner, g.state)!;
    expect(ahead.home!).toBeGreaterThan(start.home! + 0.2);
    expect(engine.reprice(teamGoals, g.state)!.yes!).toBeGreaterThan(teamGoals.prior.yes!);

    g.ev('score_update', { minute: 88, clock: { period: 2, display: "88'" } });
    expect(engine.reprice(winner, g.state)!.home!).toBeGreaterThan(0.9);
    expect(engine.reprice(teamGoals, g.state)!.yes!).toBeLessThan(0.1);
    const next = marketFromCandidate({ ...one(cands, TEMPLATES.soccerWinner), templateId: TEMPLATES.soccerNextGoal, outcomes: [{ id: 'home', label: 'P' }, { id: 'away', label: 'S' }, { id: 'none', label: 'None' }], resolver: { type: 'next_goal', params: {} } }, { id: 'n' });
    expect(engine.reprice(next, g.state)!.none!).toBeGreaterThan(0.9);

    // Moment markets have no live model; nothing is repriced after full time.
    const pen = marketFromCandidate({ ...one(cands, TEMPLATES.soccerWinner), resolver: { type: 'penalty_result', params: {} } }, { id: 'p' });
    expect(engine.reprice(pen, g.state)).toBeNull();
    g.ev('final', { minute: 90 });
    expect(engine.reprice(winner, g.state)).toBeNull();
  });

  it('reprices NFL winner and total from score and clock', () => {
    const engine = new HuddleQuestionEngine();
    const g = game('nfl');
    const cands = engine.propose(g.ev('kickoff', { data: { secondsRemaining: 3600 } }), g.state, []);
    const winner = marketFromCandidate(one(cands, TEMPLATES.nflWinner), { id: 'w', seq: 1 });
    const total = marketFromCandidate(one(cands, TEMPLATES.nflTotal), { id: 't', seq: 1 });
    expect(engine.reprice(winner, g.state)!.home).toBeCloseTo(winner.prior.home!, 3);
    g.ev('score_update', { team: 'TEN', clock: { period: 4, display: '5:00' }, data: { secondsRemaining: 300 }, score: { home: 7, away: 17 } });
    expect(engine.reprice(winner, g.state)!.home!).toBeLessThan(0.1);
    expect(engine.reprice(total, g.state)!.over!).toBeLessThan(0.05);
    const q = marketFromCandidate(one(cands, TEMPLATES.periodWinner), { id: 'q', seq: 1 });
    expect(engine.reprice(q, g.state)).toBeNull();
  });

  it('explains a price in plain words: the rationale, the room, the model, Gemini', () => {
    const engine = new HuddleQuestionEngine();
    const g = game('soccer');
    g.ev('kickoff');
    const pen = g.ev('penalty_awarded', { team: 'POR', player: 'Ronaldo', minute: 8 });
    const cand = one(engine.propose(pen, g.state, []), TEMPLATES.soccerPenalty);
    const market = marketFromCandidate(cand, { id: 'p', seq: pen.seq });
    market.price = { yes: 0.9, no: 0.1 };
    const text = engine.explain(market, g.state);
    expect(text).toContain(cand.rationale!);
    expect(text).toContain('Right now the room has Yes at 90%; the model opened it at 83%.');
    expect(text).not.toMatch(/Gemini has/);

    const kick = game('soccer');
    const winnerCand = one(engine.propose(kick.ev('kickoff'), kick.state, []), TEMPLATES.soccerWinner);
    const winner = marketFromCandidate(winnerCand, { id: 'w', seq: 1 });
    winner.geminiRef = { eventTicker: 'E', contractTicker: 'POR', prob: 0.44, asOf: '', outcomeId: 'home' };
    kick.ev('goal', { team: 'POR', minute: 40, score: { home: 1, away: 0 } });
    const live = engine.explain(winner, kick.state);
    expect(live).toMatch(/the live model says \d+%/);
    expect(live).toContain('Gemini has Portugal at 44%.');
    // A market with no stored rationale still gets an answer.
    winner.resolver = { type: 'match_winner', params: {} };
    expect(engine.explain(winner, kick.state)).toMatch(/^The opening price comes from the pricing model/);
  });
});

describe('calibration and factories', () => {
  it('fits soccer goal rates to a three-way Gemini moneyline or to supplied odds', () => {
    const engine = new HuddleQuestionEngine();
    const info = { id: 'g1', sport: 'soccer' as const, title: 't', home: POR, away: ESP, status: 'live' as const, source: 'mock' as const };
    const c = (ticker: string, label: string, prob: number | null) => ({ eventTicker: 'E', contractTicker: ticker, label, prob, source: 'mid' as const, asOf: '' });
    engine.calibrate(info, [{ eventTicker: 'E', title: 't', kind: 'moneyline', contracts: [c('POR', 'Portugal', 0.6), c('D', 'Draw', 0.22), c('ESP', 'Spain', 0.18)] }]);
    const rates = engine.model('g1').soccer;
    expect(rates.source).toBe('gemini');
    expect(rates.home).toBeGreaterThan(rates.away);
    const g = game('soccer');
    const winner = one(engine.propose(g.ev('kickoff'), g.state, []), TEMPLATES.soccerWinner);
    expect(winner.prior.home!).toBeCloseTo(0.6, 1);
    expect(winner.rationale).toMatch(/rates fitted to Gemini/);

    // Unusable quotes leave the defaults alone.
    const other = new HuddleQuestionEngine();
    other.calibrate(info, [{ eventTicker: 'E', title: 't', kind: 'moneyline', contracts: [c('POR', 'Portugal', null), c('ESP', 'Spain', null)] }]);
    expect(other.model('g1').soccer.source).toBe('default');
    other.calibrate({ ...info, sport: 'nfl', home: DAL, away: TEN }, [{ eventTicker: 'E', title: 't', kind: 'total', contracts: [c('O30', 'More than 30.5 points scored', 0.97)] }]);
    expect(other.model('g1').nfl.source).toBe('default');
    expect(other.setSoccerOdds('g1', 0.2, 0.25, 0.55).away).toBeGreaterThan(other.model('g1').soccer.home);
  });

  it('the public factories return the real engine and a ranker that works without an LLM', async () => {
    const engine = createQuestionEngine();
    expect(engine).toBeInstanceOf(HuddleQuestionEngine);
    expect(typeof engine.calibrate).toBe('function');
    const g = game('soccer');
    const cands = engine.propose(g.ev('kickoff'), g.state, []);
    const ranker = createQuestionRanker(new MockLlmClient());
    const picks = await ranker.rank(cands, { partyName: 'p', persona: 'soccer', sport: 'soccer', points: true, score: '0-0', clock: "0'", home: 'Portugal', away: 'Spain', leaderboard: [], recentResults: [] }, 2);
    expect(picks).toEqual([
      { index: 0, question: cands[0]!.question, hook: cands[0]!.hook },
      { index: 1, question: cands[1]!.question, hook: cands[1]!.hook },
    ]);
  });
});
