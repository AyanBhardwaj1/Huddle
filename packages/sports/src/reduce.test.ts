import { describe, expect, it } from 'vitest';
import { initialGameState, type GameEvent, type GameState } from '@huddle/shared';
import { loadTimelines, resolveReplayDir, type Timeline } from './replay';
import { nflSecondsRemaining, reduce, sideOf } from './reduce';

const timelines = loadTimelines(resolveReplayDir());
const soccer = timelines.find((t) => t.info.sport === 'soccer')!;
const nfl = timelines.find((t) => t.info.sport === 'nfl')!;

function events(t: Timeline): GameEvent[] {
  return t.events.map((e) => ({ ...e.event, ts: new Date(1_800_000_000_000 + e.atMs).toISOString() }));
}

function play(t: Timeline, until?: (e: GameEvent) => boolean): { state: GameState; states: GameState[] } {
  let state = initialGameState(t.info.id, t.info.sport, t.info.home, t.info.away);
  const states: GameState[] = [];
  for (const e of events(t)) {
    state = reduce(state, e);
    states.push(state);
    if (until?.(e)) break;
  }
  return { state, states };
}

describe('reduce: soccer', () => {
  it('starts pre, goes live at kickoff and ends final with the full-time score', () => {
    const start = initialGameState(soccer.info.id, 'soccer', soccer.info.home, soccer.info.away);
    expect(start.status).toBe('pre');
    const { state, states } = play(soccer);
    expect(states[0]!.status).toBe('live');
    expect(state.status).toBe('final');
    expect(state.score).toEqual({ home: 4, away: 3 });
    expect(state.minute).toBe(90);
    expect(state.lastSeq).toBe(soccer.events.length);
    expect(state.lastEvent?.type).toBe('final');
  });

  it('keeps the counters and period scores', () => {
    const { state } = play(soccer);
    expect(state.counters).toMatchObject({
      goals_total: 7,
      goals_home: 4,
      goals_away: 3,
      goals_period_1_home: 2,
      goals_period_1_away: 1,
      goals_period_2_home: 2,
      goals_period_2_away: 2,
      cards_total: 4,
      cards_home: 2,
      cards_away: 2,
      yellow_total: 4,
      cards_period_1: 2,
      cards_period_2: 2,
      corners_total: 4,
      corners_home: 2,
      corners_away: 2,
      penalties_total: 1,
      penalties_home: 1,
      penalties_scored_home: 1,
      subs_home: 1,
    });
    expect(state.periodScores).toEqual([
      { period: 1, home: 2, away: 1 },
      { period: 2, home: 4, away: 3 },
    ]);
  });

  it('tracks the minute and clock as the match moves', () => {
    const { state } = play(soccer, (e) => e.type === 'penalty_awarded');
    expect(state.minute).toBe(8);
    expect(state.clock).toEqual({ period: 1, display: "8'" });
    expect(state.score).toEqual({ home: 0, away: 0 });
    expect(state.counters.penalties_home).toBe(1);
  });

  it('is pure: the previous state is not mutated', () => {
    const a = initialGameState(soccer.info.id, 'soccer', soccer.info.home, soccer.info.away);
    const frozen = JSON.stringify(a);
    const b = reduce(a, events(soccer)[0]!);
    expect(JSON.stringify(a)).toBe(frozen);
    expect(b).not.toBe(a);
    expect(b.counters).not.toBe(a.counters);
  });

  it('counts a single-event corner (flag already set) once', () => {
    let s = initialGameState('g', 'soccer', { name: 'Home', short: 'HOM' }, { name: 'Away', short: 'AWY' });
    const ev = (seq: number, data: Record<string, unknown>): GameEvent => ({ gameId: 'g', sport: 'soccer', seq, ts: '', clock: { period: 1, display: "5'" }, type: 'corner', team: 'HOM', data, score: { home: 0, away: 0 } });
    s = reduce(s, ev(1, { minute: 5, shotOnTarget: true }));
    expect(s.counters.corners_home).toBe(1);
    s = reduce(s, ev(2, { minute: 9 }));
    s = reduce(s, ev(3, { minute: 10, shotOnTarget: false }));
    expect(s.counters.corners_home).toBe(2);
    expect(s.counters.corners_total).toBe(2);
  });
});

describe('reduce: NFL', () => {
  it('follows possession, down, distance and yard line', () => {
    const first = play(nfl, (e) => e.type === 'snap');
    expect(first.state.possession).toBe('home');
    expect(first.state).toMatchObject({ down: 3, distance: 3, yardline: 32, status: 'live' });
    expect(first.state.secondsRemaining).toBe(2700 + 13 * 60 + 8);

    // After the conversion: 1st and 10 at the 44.
    const idx = nfl.events.findIndex((e) => e.event.type === 'snap');
    const afterConversion = play(nfl).states[idx + 1]!;
    expect(afterConversion).toMatchObject({ down: 1, distance: 10, yardline: 44 });

    // First and goal from the 5.
    const goalToGo = play(nfl, (e) => e.type === 'play_result' && e.data.yardline === 87);
    expect(goalToGo.state).toMatchObject({ down: 1, distance: 5, yardline: 95 });

    const tenBall = play(nfl, (e) => e.type === 'drive_start' && e.team === 'TEN');
    expect(tenBall.state.possession).toBe('away');
    expect(tenBall.state).toMatchObject({ down: 1, distance: 10, yardline: 25 });
  });

  it('ends final with scores by quarter and the scoring counters', () => {
    const { state } = play(nfl);
    expect(state.status).toBe('final');
    expect(state.secondsRemaining).toBe(0);
    expect(state.score).toEqual({ home: 14, away: 9 });
    expect(state.periodScores).toEqual([
      { period: 1, home: 7, away: 0 },
      { period: 2, home: 7, away: 3 },
      { period: 3, home: 7, away: 9 },
      { period: 4, home: 14, away: 9 },
    ]);
    expect(state.counters).toMatchObject({
      points_period_1_home: 7,
      points_period_2_away: 3,
      points_period_3_away: 6,
      points_period_4_home: 7,
      touchdowns_home: 2,
      touchdowns_away: 1,
      field_goals_away: 1,
      drives_home: 2,
      drives_away: 2,
      third_down_attempts_home: 3,
      third_down_conversions_home: 2,
      third_down_attempts_away: 2,
      third_down_conversions_away: 1,
      fourth_down_attempts_home: 1,
      fourth_down_conversions_home: 1,
      red_zone_trips_home: 2,
      red_zone_trips_away: 1,
    });
    expect(state.down).toBeUndefined();
  });

  it('parses the game clock', () => {
    expect(nflSecondsRemaining(1, '15:00')).toBe(3600);
    expect(nflSecondsRemaining(4, '2:05')).toBe(125);
    expect(nflSecondsRemaining(2, '0:00')).toBe(1800);
    expect(nflSecondsRemaining(5, '10:00')).toBe(0);
    expect(nflSecondsRemaining(1, 'halftime')).toBeUndefined();
  });

  it('resolves team codes to sides', () => {
    expect(sideOf(nfl.info, 'DAL')).toBe('home');
    expect(sideOf(nfl.info, 'ten')).toBe('away');
    expect(sideOf(nfl.info, 'SF')).toBeUndefined();
    expect(sideOf(nfl.info, undefined)).toBeUndefined();
  });
});
