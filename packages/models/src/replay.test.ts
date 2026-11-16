import { describe, expect, it } from 'vitest';
import { loadTimelines, resolveReplayDir } from '@huddle/sports';
import { HuddleQuestionEngine, TEMPLATES } from './engine';
import { simulateReplay, type SimMarket } from './testkit';

const timelines = loadTimelines(resolveReplayDir());
const soccerTimeline = timelines.find((t) => t.info.id === 'replay-por-esp')!;
const nflTimeline = timelines.find((t) => t.info.id === 'replay-ten-dal')!;

const sum = (prior: Record<string, number>): number => Object.values(prior).reduce((a, b) => a + b, 0);
const secs = (s: SimMarket[]): number[] => s.map((m) => m.openedAtMs / 1000);
const outcomes = (s: SimMarket[]): (string | undefined)[] => s.map((m) => m.outcome);

/** Checks every replay must pass, whatever the sport. */
function commonChecks(markets: SimMarket[]): void {
  expect(markets.length).toBeGreaterThan(8);
  for (const m of markets) {
    const c = m.candidate;
    const where = `${c.templateId} @ ${m.openedAtMs / 1000}s`;
    // Sensible, normalized priors on exactly the listed outcomes.
    expect(Object.keys(c.prior).sort(), where).toEqual(c.outcomes.map((o) => o.id).sort());
    expect(sum(c.prior), where).toBeCloseTo(1, 6);
    for (const p of Object.values(c.prior)) {
      expect(p, where).toBeGreaterThanOrEqual(0.02);
      expect(p, where).toBeLessThanOrEqual(0.98);
    }
    // Complete candidate: text, a way to lock, a resolver, a rationale that explains the price.
    expect(c.question.length, where).toBeGreaterThan(10);
    expect(c.question.length, where).toBeLessThanOrEqual(80);
    expect(c.hook.split(/\s+/).length, where).toBeLessThanOrEqual(25);
    expect(c.rationale && c.rationale.length > 20, where).toBe(true);
    expect(c.resolver.params.rationale, where).toBe(c.rationale);
    expect(c.lockAfterSecs !== undefined || c.lockOnEvent !== undefined, where).toBe(true);
    expect(c.priority, where).toBeGreaterThan(0);
    // Every market reaches an outcome by the end of the replay; none is left hanging or voided.
    expect(m.market.state, where).toBe('resolved');
    expect(c.outcomes.map((o) => o.id), where).toContain(m.outcome);
    expect(m.resolvedAtMs!, where).toBeGreaterThan(m.openedAtMs);
    expect(m.lockedAtMs!, where).toBeLessThanOrEqual(m.resolvedAtMs!);
  }
  // Moment markets leave room to bet, and are locked before the answer is known.
  const moments = markets.filter((m) => m.market.kind === 'moment');
  for (const m of moments) {
    const where = `${m.market.templateId} @ ${m.openedAtMs / 1000}s`;
    expect(m.candidate.lockAfterSecs, where).toBeGreaterThanOrEqual(15);
    expect(m.lockedBy, where).toBe('countdown');
    expect(m.resolvedAtMs! - m.openedAtMs, where).toBeGreaterThanOrEqual(20_000);
    expect(m.resolvedAtMs!, where).toBeGreaterThan(m.lockedAtMs!);
  }
  // The engine allows one new moment market per 20 s: the replays are authored to respect that.
  const opens = [...new Set(moments.map((m) => m.openedAtMs))].sort((a, b) => a - b);
  for (let i = 1; i < opens.length; i++) expect(opens[i]! - opens[i - 1]!, `moment markets at ${opens[i - 1]} and ${opens[i]}`).toBeGreaterThanOrEqual(20_000);
}

describe('Portugal vs Spain through reduce + propose + resolvers', () => {
  const sim = simulateReplay(soccerTimeline, new HuddleQuestionEngine());

  it('passes the common checks', () => {
    expect(sim.state.status).toBe('final');
    expect(sim.state.score).toEqual({ home: 4, away: 3 });
    commonChecks(sim.markets);
  });

  it('opens three game-long markets at kickoff', () => {
    const atKickoff = sim.markets.filter((m) => m.openedAtMs === 2000);
    expect(atKickoff.map((m) => m.market.templateId).sort()).toEqual([TEMPLATES.soccerTeamGoals, TEMPLATES.soccerTotalGoals, TEMPLATES.soccerWinner].sort());
    expect(atKickoff.every((m) => m.market.kind === 'game')).toBe(true);

    const [winner] = sim.byTemplate(TEMPLATES.soccerWinner);
    expect(winner!.candidate.geminiHint).toEqual({ kind: 'moneyline' });
    expect(winner!.market.prior.home!).toBeGreaterThan(winner!.market.prior.away!);
    expect(winner!.market.prior.draw!).toBeGreaterThan(0.2);
    expect(winner!.lockedBy).toBe('event');
    expect(winner!.lockedAtMs).toBe(354_000); // the 80th-minute mark
    expect(winner!.outcome).toBe('home');
    expect(winner!.resolvedAtMs).toBe(407_000);

    const [teamGoals] = sim.byTemplate(TEMPLATES.soccerTeamGoals);
    expect(teamGoals!.market.question).toBe('Will Portugal score 2+ goals?');
    expect(teamGoals!.market.prior.yes!).toBeGreaterThanOrEqual(0.25);
    expect(teamGoals!.market.prior.yes!).toBeLessThanOrEqual(0.6);
    expect(teamGoals!.outcome).toBe('yes');
    expect(teamGoals!.resolvedAtMs).toBe(197_000); // Portugal's second goal

    const [total] = sim.byTemplate(TEMPLATES.soccerTotalGoals);
    expect(total!.market.question).toBe('Will there be 3+ goals in the match?');
    expect(total!.market.prior.yes!).toBeGreaterThanOrEqual(0.25);
    expect(total!.market.prior.yes!).toBeLessThanOrEqual(0.6);
    expect(total!.outcome).toBe('yes');
  });

  it('the Ronaldo penalty is the hero moment', () => {
    const pens = sim.byTemplate(TEMPLATES.soccerPenalty);
    expect(pens).toHaveLength(1);
    const pen = pens[0]!;
    expect(pen.openedAtMs).toBe(32_000);
    expect(pen.market.question).toBe('Will Ronaldo score this penalty?');
    expect(pen.market.kind).toBe('moment');
    // Base rate about 74%, pulled up by the taker's record.
    expect(pen.market.prior.yes!).toBeGreaterThan(0.78);
    expect(pen.market.prior.yes!).toBeLessThan(0.88);
    expect(pen.candidate.rationale).toMatch(/Ronaldo's record is \d+ of \d+/);
    expect(pen.candidate.priority).toBe(Math.max(...sim.markets.map((m) => m.candidate.priority)));
    expect(pen.lockedAtMs).toBe(52_000);
    expect(pen.resolvedAtMs).toBe(59_000);
    expect(pen.outcome).toBe('yes');
  });

  it('cards, corners, next goal and the second half fire at the right moments', () => {
    const cards = sim.byTemplate(TEMPLATES.soccerCard);
    expect(secs(cards)).toEqual([78, 146]);
    expect(outcomes(cards)).toEqual(['yes', 'no']);
    expect(cards[0]!.resolvedAtMs).toBe(146_000); // the next booking
    expect(cards[1]!.resolvedAtMs).toBe(206_000); // halftime
    // Less time to the break means a lower price for another card.
    expect(cards[1]!.market.prior.yes!).toBeLessThan(cards[0]!.market.prior.yes!);

    const corners = sim.byTemplate(TEMPLATES.soccerCorner);
    expect(secs(corners)).toEqual([100, 168, 254, 364]);
    expect(outcomes(corners)).toEqual(['yes', 'no', 'yes', 'no']);
    expect(corners.map((c) => c.market.question)).toEqual([
      'Shot on target from this Portugal corner?',
      'Shot on target from this Spain corner?',
      'Shot on target from this Portugal corner?',
      'Shot on target from this Spain corner?',
    ]);
    expect(corners[0]!.market.prior.yes!).toBeLessThan(0.2);

    const next = sim.byTemplate(TEMPLATES.soccerNextGoal);
    expect(secs(next)).toEqual([284]); // the 60th-minute mark, once
    expect(next[0]!.market.outcomes.map((o) => o.id)).toEqual(['home', 'away', 'none']);
    expect(next[0]!.market.prior.home!).toBeGreaterThan(next[0]!.market.prior.away!);
    expect(next[0]!.outcome).toBe('home');
    expect(next[0]!.resolvedAtMs).toBe(316_000);

    const half = sim.byTemplate(TEMPLATES.periodWinner);
    expect(secs(half)).toEqual([216]);
    expect(half[0]!.candidate.geminiHint).toEqual({ kind: 'period_winner', period: '2H' });
    expect(half[0]!.outcome).toBe('draw'); // 2-2 after the break
  });

  it('proposes nothing else', () => {
    const counts: Record<string, number> = {};
    for (const m of sim.markets) counts[m.market.templateId!] = (counts[m.market.templateId!] ?? 0) + 1;
    expect(counts).toEqual({
      [TEMPLATES.soccerWinner]: 1,
      [TEMPLATES.soccerTeamGoals]: 1,
      [TEMPLATES.soccerTotalGoals]: 1,
      [TEMPLATES.soccerPenalty]: 1,
      [TEMPLATES.soccerCard]: 2,
      [TEMPLATES.soccerCorner]: 4,
      [TEMPLATES.soccerNextGoal]: 1,
      [TEMPLATES.periodWinner]: 1,
    });
  });
});

describe('Titans at Cowboys through reduce + propose + resolvers', () => {
  const sim = simulateReplay(nflTimeline, new HuddleQuestionEngine());

  it('passes the common checks', () => {
    expect(sim.state.status).toBe('final');
    expect(sim.state.score).toEqual({ home: 14, away: 9 });
    commonChecks(sim.markets);
  });

  it('opens winner, total and first-quarter markets at kickoff', () => {
    const atKickoff = sim.markets.filter((m) => m.openedAtMs === 2000);
    expect(atKickoff.map((m) => m.market.templateId).sort()).toEqual([TEMPLATES.periodWinner, TEMPLATES.nflTotal, TEMPLATES.nflWinner].sort());

    const [winner] = sim.byTemplate(TEMPLATES.nflWinner);
    expect(winner!.candidate.geminiHint).toEqual({ kind: 'moneyline' });
    expect(winner!.market.question).toBe('Who wins: Titans or Cowboys?');
    expect(winner!.lockedAtMs).toBe(211_000); // end of the third quarter
    expect(winner!.outcome).toBe('home');

    const [total] = sim.byTemplate(TEMPLATES.nflTotal);
    expect(total!.market.question).toBe('Total points: over or under 44.5?');
    expect(total!.candidate.geminiHint).toEqual({ kind: 'total', line: 44.5 });
    expect(total!.market.prior.over!).toBeGreaterThan(0.4);
    expect(total!.market.prior.over!).toBeLessThan(0.6);
    expect(total!.outcome).toBe('under');
  });

  it('asks about every featured 3rd and 4th down, priced by down and distance', () => {
    const conv = sim.byTemplate(TEMPLATES.nflConversion);
    expect(secs(conv)).toEqual([26, 109, 146, 238]);
    expect(conv.map((c) => c.market.question)).toEqual([
      'Do the Cowboys convert on 3rd & 3?',
      'Do the Titans convert on 3rd & 2?',
      'Do the Titans convert on 3rd & 8?',
      'Do the Cowboys convert on 4th & 2?',
    ]);
    expect(outcomes(conv)).toEqual(['yes', 'yes', 'no', 'yes']);
    const yes = conv.map((c) => c.market.prior.yes!);
    expect(yes[1]!).toBeGreaterThan(yes[0]!); // 3rd & 2 beats 3rd & 3
    expect(yes[0]!).toBeGreaterThan(yes[2]!); // 3rd & 3 beats 3rd & 8
    expect(yes[2]!).toBeGreaterThan(0.2);
    expect(yes[2]!).toBeLessThan(0.4);
    for (const c of conv) {
      expect(c.candidate.lockOnEvent).toBe('play_result');
      expect(c.lockedAtMs).toBe(c.openedAtMs + 15_000);
      expect(c.candidate.rationale).toMatch(/nflverse 2021 to 2025/);
    }
    // The 4th-down price is the "they are going for it" price, not the punt-heavy one.
    expect(yes[3]!).toBeGreaterThan(0.45);
  });

  it('prices drives by field position and resolves them from the feed', () => {
    const drives = sim.byTemplate(TEMPLATES.nflDrive);
    expect(secs(drives)).toEqual([5, 88, 182, 216]);
    expect(outcomes(drives)).toEqual(['td', 'fg', 'td', 'td']);
    expect(drives.map((d) => d.market.question)).toEqual([
      'Cowboys drive: touchdown, field goal or no score?',
      'Titans drive: touchdown, field goal or no score?',
      'Titans drive: touchdown, field goal or no score?',
      'Cowboys drive: touchdown, field goal or no score?',
    ]);
    for (const d of drives) {
      expect(d.market.prior.none!).toBeGreaterThan(d.market.prior.td!);
      expect(d.market.prior.td!).toBeGreaterThan(d.market.prior.fg!);
    }
    // The field-goal drive resolves on the kick, the touchdown drives on the scoring play.
    expect(drives[1]!.resolvedAtMs).toBe(171_000);
    expect(drives[0]!.resolvedAtMs).toBe(79_000);
  });

  it('opens a red-zone market on entry, not on a failed 3rd down', () => {
    const rz = sim.byTemplate(TEMPLATES.nflRedZone);
    expect(secs(rz)).toEqual([56, 260]);
    expect(outcomes(rz)).toEqual(['yes', 'yes']);
    expect(rz[0]!.market.question).toBe('Touchdown for the Cowboys on this possession?');
    expect(rz[0]!.market.prior.yes!).toBeGreaterThan(0.45);
    expect(rz[0]!.market.prior.yes!).toBeLessThan(0.65);
    // Tennessee crossed the 20 on a failed 3rd & 8 at 168 s: field-goal time, no market.
    expect(secs(rz)).not.toContain(168);
  });

  it('asks who wins each period and resolves on points scored in it', () => {
    const periods = sim.byTemplate(TEMPLATES.periodWinner);
    expect(secs(periods)).toEqual([2, 86, 179]);
    expect(periods.map((p) => p.market.question)).toEqual(['Who wins the 1st quarter?', 'Who wins the 2nd quarter?', 'Who wins the 2nd half?']);
    expect(periods.map((p) => p.candidate.geminiHint?.period)).toEqual(['1Q', '2Q', '2H']);
    expect(outcomes(periods)).toEqual(['home', 'away', 'home']); // 7-0, 0-3, 7-6
    expect(periods.map((p) => p.resolvedAtMs)).toEqual([84_000, 176_000, 289_000]);
    for (const p of periods) expect(p.market.outcomes.map((o) => o.id)).toEqual(['home', 'tie', 'away']);
  });

  it('proposes nothing else', () => {
    const counts: Record<string, number> = {};
    for (const m of sim.markets) counts[m.market.templateId!] = (counts[m.market.templateId!] ?? 0) + 1;
    expect(counts).toEqual({
      [TEMPLATES.nflWinner]: 1,
      [TEMPLATES.nflTotal]: 1,
      [TEMPLATES.periodWinner]: 3,
      [TEMPLATES.nflDrive]: 4,
      [TEMPLATES.nflConversion]: 4,
      [TEMPLATES.nflRedZone]: 2,
    });
  });
});

describe('replays with a Gemini-calibrated model', () => {
  it('still resolves everything, with the calibrated line and favourite', () => {
    const engine = new HuddleQuestionEngine();
    const asOf = '2026-11-16T12:00:00.000Z';
    engine.calibrate(nflTimeline.info, [
      {
        eventTicker: 'NFL-2611221800-TEN-DAL-M',
        title: 'Tennessee vs Dallas',
        kind: 'moneyline',
        contracts: [
          { eventTicker: 'NFL-2611221800-TEN-DAL-M', contractTicker: 'DAL', label: 'Dallas', prob: 0.795, source: 'mid', asOf },
          { eventTicker: 'NFL-2611221800-TEN-DAL-M', contractTicker: 'TEN', label: 'Tennessee', prob: 0.205, source: 'mid', asOf },
        ],
      },
      {
        eventTicker: 'NFL-2611221800-TEN-DAL-T',
        title: 'Tennessee vs Dallas: Total Points',
        kind: 'total',
        contracts: [
          { eventTicker: 'NFL-2611221800-TEN-DAL-T', contractTicker: 'O53', label: 'More than 53.5 points scored', prob: 0.5, source: 'mid', asOf },
          { eventTicker: 'NFL-2611221800-TEN-DAL-T', contractTicker: 'O54', label: 'More than 54.5 points scored', prob: null, source: 'unavailable', asOf },
        ],
      },
    ]);
    const sim = simulateReplay(nflTimeline, engine);
    commonChecks(sim.markets);
    const [winner] = sim.byTemplate(TEMPLATES.nflWinner);
    expect(winner!.market.prior.home!).toBeCloseTo(0.795, 2);
    expect(winner!.candidate.rationale).toMatch(/calibrated to Gemini/);
    const [total] = sim.byTemplate(TEMPLATES.nflTotal);
    expect(total!.market.question).toBe('Total points: over or under 53.5?');
    expect(total!.candidate.geminiHint).toEqual({ kind: 'total', line: 53.5 });
    expect(total!.market.prior.over!).toBeCloseTo(0.5, 2);
    // A stronger home side tilts the quarter prices too.
    const base = simulateReplay(nflTimeline, new HuddleQuestionEngine());
    expect(sim.byTemplate(TEMPLATES.periodWinner)[0]!.market.prior.home!).toBeGreaterThan(base.byTemplate(TEMPLATES.periodWinner)[0]!.market.prior.home!);
    expect(sim.byTemplate(TEMPLATES.periodWinner)[0]!.market.prior.tie!).toBeCloseTo(base.byTemplate(TEMPLATES.periodWinner)[0]!.market.prior.tie!, 3);
  });
});
