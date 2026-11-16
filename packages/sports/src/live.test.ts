import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameEvent, type GameState } from '@huddle/shared';
import apifFixture from './__fixtures__/apifootball-fixture.synthetic.json';
import nflScoreboard from './__fixtures__/espn-nfl-scoreboard.json';
import nflSummary from './__fixtures__/espn-nfl-summary.json';
import soccerScoreboard from './__fixtures__/espn-soccer-scoreboard.json';
import soccerSummary from './__fixtures__/espn-soccer-summary.json';
import { ApiFootballAdapter, mapApiFootballFixture, mapApiFootballFixtures } from './apifootball';
import { EspnAdapter, mapEspnNflSummary, mapEspnScoreboard, mapEspnSoccerSummary } from './espn';
import { CompositeSportsAdapter, createSportsAdapter } from './index';
import type { FetchLike, KeyedEvent } from './live';
import { reduce } from './reduce';
import { ReplayAdapter, resolveReplayDir } from './replay';

function fold(sport: 'soccer' | 'nfl', home: { name: string; short: string }, away: { name: string; short: string }, events: KeyedEvent[]): GameState {
  let state = initialGameState('g', sport, home, away);
  events.forEach((k, i) => {
    const e: GameEvent = { gameId: 'g', sport, seq: i + 1, ts: '', clock: k.clock, type: k.type, team: k.team, player: k.player, data: k.data, score: k.score, text: k.text };
    state = reduce(state, e);
  });
  return state;
}

function fakeFetch(routes: Record<string, unknown>, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[hit] };
  };
}

describe('ESPN mapping (recorded payloads, trimmed)', () => {
  it('maps scoreboards to games', () => {
    const nfl = mapEspnScoreboard(nflScoreboard, 'nfl', 'nfl');
    expect(nfl.map((g) => g.id)).toEqual(['espn:nfl:401873065', 'espn:nfl:401873063']);
    expect(nfl[0]).toMatchObject({ sport: 'nfl', source: 'espn', status: 'scheduled', title: 'Los Angeles Chargers at Baltimore Ravens', home: { short: 'BAL' }, away: { short: 'LAC' }, startsAt: '2026-11-17T01:15:00.000Z' });
    expect(nfl[1]).toMatchObject({ status: 'final', home: { name: 'Dallas Cowboys', short: 'DAL' }, away: { short: 'SF' } });

    const soccer = mapEspnScoreboard(soccerScoreboard, 'soccer', 'soccer:eng.1');
    expect(soccer).toHaveLength(2);
    expect(soccer[1]).toMatchObject({ id: 'espn:soccer:eng.1:401878757', sport: 'soccer', status: 'final', home: { short: 'NFO' }, away: { short: 'MNC' } });
    expect(mapEspnScoreboard({ events: [{ id: 'x' }, null, 7] }, 'nfl', 'nfl')).toEqual([]);
    expect(mapEspnScoreboard(null, 'nfl', 'nfl')).toEqual([]);
  });

  it('maps an NFL summary to drives, snaps and play results', () => {
    const { events, teams, done } = mapEspnNflSummary(nflSummary);
    expect(done).toBe(true);
    expect(teams?.home.short).toBe('DAL');
    expect(teams?.away.short).toBe('SF');
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
    expect(events[0]!.type).toBe('kickoff');
    expect(events[1]).toMatchObject({ type: 'drive_start', team: 'DAL', data: { yardline: 31 } });

    // The opening kickoff leaves 1st and 10 at the DAL 31.
    expect(events[2]).toMatchObject({ type: 'snap', team: 'DAL', data: { down: 1, distance: 10, yardline: 31, secondsRemaining: 3600 } });
    // A flagged play is a no-play, not a result.
    const penalty = events.find((e) => e.type === 'play_result' && e.data.noPlay === true)!;
    expect(penalty.data).toMatchObject({ down: 2, distance: 10, playType: 'penalty' });
    // 3rd and 1 at the 55: run for 8, first down.
    const third = events.find((e) => e.type === 'play_result' && e.data.down === 3 && e.data.distance === 1)!;
    expect(third).toMatchObject({ team: 'DAL', data: { yardline: 55, playType: 'run', gained: 8, firstDown: true } });
    const snapBefore = events[events.indexOf(third) - 1]!;
    expect(snapBefore).toMatchObject({ type: 'snap', data: { down: 3, distance: 1, yardline: 55 } });
    // 52-yard field goal on 4th and 7.
    const fg = events.find((e) => e.type === 'play_result' && e.data.playType === 'kick')!;
    expect(fg).toMatchObject({ data: { down: 4, distance: 7, good: true, kickYards: 52, firstDown: false }, score: { home: 3, away: 0 } });
    expect(events[events.indexOf(fg) + 1]).toMatchObject({ type: 'drive_end', team: 'DAL', data: { result: 'fg' } });

    const ends = events.filter((e) => e.type === 'drive_end').map((e) => `${e.team}:${String(e.data.result)}`);
    expect(ends).toEqual(['DAL:fg', 'SF:td', 'DAL:td', 'SF:none']);
    const td = events.find((e) => e.type === 'play_result' && e.data.touchdown === true)!;
    expect(td).toMatchObject({ team: 'SF', data: { playType: 'pass', firstDown: true, yardline: 89, gained: 11 }, score: { home: 3, away: 7 } });
    expect(events[events.length - 1]).toMatchObject({ type: 'final', score: { home: 40, away: 46 } });

    const state = fold('nfl', teams!.home, teams!.away, events);
    expect(state.status).toBe('final');
    expect(state.counters.touchdowns_away).toBe(1);
    expect(state.counters.field_goals_home).toBe(1);
  });

  it('maps a soccer summary to goals, cards, corners with outcomes and period markers', () => {
    const { events, teams, done } = mapEspnSoccerSummary(soccerSummary);
    expect(done).toBe(true);
    expect(teams?.home.short).toBe('NFO');
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
    expect(events[0]!.type).toBe('kickoff');
    expect(events[events.length - 1]).toMatchObject({ type: 'final', score: { home: 3, away: 1 } });

    const goals = events.filter((e) => e.type === 'goal');
    expect(goals.map((g) => `${g.team} ${g.player} ${g.clock.display}`)).toEqual(['NFO Jair Cunha 6\'', 'NFO Liam Delap 18\'', 'MNC Rayan Cherki 52\'', 'NFO Liam Delap 73\'']);
    expect(goals.map((g) => `${g.score.home}-${g.score.away}`)).toEqual(['1-0', '2-0', '2-1', '3-1']);
    expect(events.filter((e) => e.type === 'card').map((c) => c.data.color)).toEqual(['yellow', 'yellow', 'yellow', 'yellow']);

    const awards = events.filter((e) => e.type === 'corner' && typeof e.data.shotOnTarget !== 'boolean');
    const outcomes = events.filter((e) => e.type === 'corner' && typeof e.data.shotOnTarget === 'boolean');
    expect(awards.length).toBeGreaterThanOrEqual(8);
    expect(outcomes).toHaveLength(awards.length);
    // Each outcome follows its own award, for the same team.
    awards.forEach((a) => {
      const o = events.find((e) => e.key === `${a.key}:outcome`)!;
      expect(events.indexOf(o)).toBeGreaterThan(events.indexOf(a));
      expect(o.team).toBe(a.team);
    });
    expect(outcomes.filter((o) => o.data.shotOnTarget === true).length).toBeGreaterThanOrEqual(1);

    const order = events.map((e) => e.key);
    expect(order.indexOf('period:1:end')).toBeLessThan(order.indexOf('period:2:start'));
    expect(order.indexOf('period:2:end')).toBe(order.length - 2);
    // Stoppage time never pushes the minute past the end of the half.
    expect(Math.max(...events.filter((e) => e.clock.period === 1).map((e) => Number(e.data.minute)))).toBeLessThanOrEqual(45);

    const state = fold('soccer', teams!.home, teams!.away, events);
    expect(state.status).toBe('final');
    expect(state.score).toEqual({ home: 3, away: 1 });
    expect(state.counters.cards_total).toBe(4);
    expect(state.counters.corners_total).toBe(awards.length);
    expect(state.periodScores).toEqual([
      { period: 1, home: 2, away: 0 },
      { period: 2, home: 3, away: 1 },
    ]);
  });

  it('reads penalties from commentary text (synthetic lines in the documented wording)', () => {
    const base = soccerSummary as unknown as { header: unknown };
    const line = (seq: number, value: number, text: string, play?: Record<string, unknown>): Record<string, unknown> => ({ sequence: seq, time: { value, displayValue: `${Math.floor(value / 60) + 1}'` }, text, play });
    const team = { displayName: 'Manchester City' };
    const { events } = mapEspnSoccerSummary({
      header: base.header,
      keyEvents: [],
      commentary: [
        line(1, 600, 'Penalty Manchester City. Rayan Cherki draws a foul in the penalty area.'),
        line(2, 601, 'Penalty conceded by Murillo (Nottingham Forest) after a foul in the penalty area.'),
        line(3, 660, 'Goal! Nottingham Forest 0, Manchester City 1. Erling Haaland converts the penalty.', { id: 'p1', type: { type: 'penalty---scored' }, period: { number: 1 }, clock: { value: 660, displayValue: "12'" }, team, participants: [{ athlete: { displayName: 'Erling Haaland' } }] }),
        line(4, 1200, 'Penalty saved! Erling Haaland (Manchester City).', { id: 'p2', type: { type: 'penalty---saved' }, period: { number: 1 }, clock: { value: 1200, displayValue: "21'" }, team, participants: [{ athlete: { displayName: 'Erling Haaland' } }] }),
      ],
    });
    expect(events.map((e) => e.type)).toEqual(['penalty_awarded', 'penalty_result', 'goal', 'penalty_result', 'period_end', 'final']);
    expect(events[0]).toMatchObject({ team: 'MNC', player: 'Rayan Cherki', data: { minute: 10 } });
    expect(events[1]).toMatchObject({ team: 'MNC', player: 'Erling Haaland', data: { scored: true } });
    expect(events[2]).toMatchObject({ team: 'MNC', data: { penalty: true } });
    expect(events[3]).toMatchObject({ data: { scored: false } });
  });

  it('survives junk payloads', () => {
    expect(mapEspnNflSummary(null).events).toEqual([]);
    expect(mapEspnNflSummary({ header: { competitions: [{}] }, drives: 'nope' }).events).toEqual([]);
    expect(mapEspnSoccerSummary({ header: {}, commentary: [1, 'x', null] }).events).toEqual([]);
    const partial = mapEspnNflSummary({ header: (nflSummary as { header: unknown }).header, drives: { previous: [{ id: 'd', team: { abbreviation: 'DAL' }, plays: [{}, { id: 'p' }, { id: 'q', type: { text: 'Rush' } }] }] } });
    expect(partial.events.some((e) => e.type === 'drive_start')).toBe(true);
  });
});

describe('ESPN adapter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lists games and plays a finished game as flagged history, then stops polling', async () => {
    const calls: string[] = [];
    const adapter = new EspnAdapter({
      soccerLeagues: ['eng.1'],
      fetch: fakeFetch({ 'football/nfl/scoreboard': nflScoreboard, 'soccer/eng.1/scoreboard': soccerScoreboard, 'summary?event=401878757': soccerSummary }, calls),
    });
    const games = await adapter.listGames();
    expect(games).toHaveLength(4);
    expect((await adapter.listGames('nfl')).every((g) => g.sport === 'nfl')).toBe(true);
    expect((await adapter.getGame('espn:soccer:eng.1:401878757'))?.title).toBe('Nottingham Forest vs Manchester City');

    const got: GameEvent[] = [];
    const feed = await adapter.open('espn:soccer:eng.1:401878757', (e) => got.push(e));
    expect(feed.control).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(got.length).toBeGreaterThan(30);
    expect(got.map((e) => e.seq)).toEqual(got.map((_, i) => i + 1));
    expect(got.every((e) => e.data.catchUp === true && e.gameId === 'espn:soccer:eng.1:401878757')).toBe(true);
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(before); // game is final: no more polls
    feed.stop();
  });

  it('emits only new events on later polls, without the catch-up flag', async () => {
    const full = mapEspnSoccerSummary(soccerSummary);
    const live = JSON.parse(JSON.stringify(soccerSummary)) as { header: { competitions: { status: { type: Record<string, unknown> } }[] }; commentary: unknown[]; keyEvents: { type: { type: string } }[] };
    live.header.competitions[0]!.status.type = { state: 'in', completed: false };
    live.keyEvents = live.keyEvents.filter((k) => k.type.type === 'kickoff');
    const allCommentary = live.commentary;
    live.commentary = allCommentary.slice(0, 3);
    let payload: unknown = JSON.parse(JSON.stringify(live));
    const adapter = new EspnAdapter({ fetch: async () => ({ ok: true, status: 200, json: async () => payload }), pollMs: 5000 });
    const got: GameEvent[] = [];
    const feed = await adapter.open('espn:soccer:eng.1:401878757', (e) => got.push(e));
    await vi.advanceTimersByTimeAsync(0);
    const firstBatch = got.length;
    expect(firstBatch).toBeGreaterThan(0);
    expect(got.every((e) => e.data.catchUp === true)).toBe(true);

    live.commentary = allCommentary.slice(0, 12);
    payload = JSON.parse(JSON.stringify(live));
    await vi.advanceTimersByTimeAsync(5000);
    const fresh = got.slice(firstBatch);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((e) => e.data.catchUp === undefined)).toBe(true);
    expect(got.map((e) => e.seq)).toEqual(got.map((_, i) => i + 1));
    expect(got.length).toBeLessThan(full.events.length);
    feed.stop();
    const after = got.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(got.length).toBe(after);
  });

  it('fails open() on a bad id or an outage so the caller can fall back', async () => {
    const adapter = new EspnAdapter({ fetch: fakeFetch({}) });
    await expect(adapter.open('replay-por-esp', () => undefined)).rejects.toThrow(/not an ESPN game id/);
    await expect(adapter.open('espn:nfl:1', () => undefined)).rejects.toThrow(/HTTP 404/);
    expect(await adapter.listGames()).toEqual([]);
  });
});

describe('API-Football mapping (synthetic payload in the documented shape)', () => {
  it('maps fixture events, penalties, own goals and status-derived period markers', () => {
    const { info, events, done } = mapApiFootballFixture(apifFixture);
    expect(done).toBe(true);
    expect(info).toMatchObject({ id: 'apif:900001', sport: 'soccer', source: 'apifootball', status: 'final', home: { name: 'Portugal', short: 'POR' }, away: { name: 'Spain', short: 'SPA' } });
    expect(events.map((e) => e.type)).toEqual([
      'kickoff',
      'card',
      'penalty_awarded',
      'penalty_result',
      'goal',
      'goal',
      'period_end',
      'period_start',
      'penalty_result',
      'sub',
      'goal',
      'card',
      'period_end',
      'final',
    ]);
    expect(events[3]).toMatchObject({ team: 'POR', player: 'Cristiano Ronaldo', data: { scored: true, minute: 24 } });
    expect(events[4]).toMatchObject({ team: 'POR', data: { penalty: true }, score: { home: 1, away: 0 } });
    expect(events[5]).toMatchObject({ team: 'SPA', clock: { period: 1, display: "45'+2'" }, score: { home: 1, away: 1 } });
    expect(events[8]).toMatchObject({ team: 'SPA', data: { scored: false }, clock: { period: 2 } });
    expect(events[10]).toMatchObject({ team: 'POR', data: { ownGoal: true }, score: { home: 2, away: 1 } });
    expect(events[11]).toMatchObject({ data: { color: 'red' } });
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);

    const state = fold('soccer', info!.home, info!.away, events);
    expect(state.score).toEqual({ home: 2, away: 1 });
    expect(state.status).toBe('final');
    expect(state.periodScores[0]).toEqual({ period: 1, home: 1, away: 1 });
  });

  it('handles not-started fixtures, lists and junk', () => {
    const ns = JSON.parse(JSON.stringify(apifFixture)) as { response: { fixture: { status: { short: string } } }[] };
    ns.response[0]!.fixture.status.short = 'NS';
    expect(mapApiFootballFixture(ns).events).toEqual([]);
    const ht = JSON.parse(JSON.stringify(apifFixture)) as typeof ns;
    ht.response[0]!.fixture.status.short = 'HT';
    const half = mapApiFootballFixture(ht);
    expect(half.done).toBe(false);
    expect(half.events[half.events.length - 1]!.type).toBe('period_end');
    expect(mapApiFootballFixtures(apifFixture).map((g) => g.id)).toEqual(['apif:900001']);
    expect(mapApiFootballFixture(null)).toEqual({ events: [], done: false });
    expect(mapApiFootballFixtures({ response: [{}, 3] })).toEqual([]);
  });

  it('adapter sends the key header and opens a fixture', async () => {
    vi.useFakeTimers();
    const seen: Record<string, string>[] = [];
    const adapter = new ApiFootballAdapter({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        seen.push(init?.headers ?? {});
        return { ok: true, status: 200, json: async () => apifFixture };
      },
    });
    expect((await adapter.listGames('nfl'))).toEqual([]);
    expect((await adapter.listGames()).map((g) => g.id)).toEqual(['apif:900001']);
    const got: GameEvent[] = [];
    const feed = await adapter.open('apif:900001', (e) => got.push(e));
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(14);
    expect(seen.every((h) => h['x-apisports-key'] === 'test-key')).toBe(true);
    await expect(adapter.open('espn:nfl:1', () => undefined)).rejects.toThrow(/not an API-Football game id/);
    feed.stop();
    vi.useRealTimers();
    expect(() => new ApiFootballAdapter({ apiKey: '' })).toThrow(/API_FOOTBALL_KEY/);
  });
});

describe('createSportsAdapter', () => {
  it('defaults to replay and falls back to replay on any bad config', () => {
    expect(createSportsAdapter({}).provider).toBe('replay');
    expect(createSportsAdapter({ SPORTS_PROVIDER: 'replay' }).provider).toBe('replay');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(createSportsAdapter({ SPORTS_PROVIDER: 'apifootball' }).provider).toBe('replay');
    expect(createSportsAdapter({ SPORTS_PROVIDER: 'carrier-pigeon' }).provider).toBe('replay');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    expect(createSportsAdapter({ SPORTS_PROVIDER: 'espn' }).provider).toBe('espn');
    expect(createSportsAdapter({ SPORTS_PROVIDER: 'apifootball', API_FOOTBALL_KEY: 'k' }).provider).toBe('apifootball');
  });

  it('honours REPLAY_DIR', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await createSportsAdapter({ REPLAY_DIR: '/definitely/not/here' }).listGames()).toEqual([]);
    warn.mockRestore();
    expect((await createSportsAdapter({ REPLAY_DIR: resolveReplayDir() }).listGames()).length).toBe(2);
  });

  it('a live provider always lists the replays too, even when it is down', async () => {
    const replay = new ReplayAdapter(resolveReplayDir());
    const down = new CompositeSportsAdapter(new EspnAdapter({ fetch: async () => { throw new Error('offline'); } }), replay);
    expect(down.provider).toBe('espn');
    expect((await down.listGames()).map((g) => g.id).sort()).toEqual(['replay-por-esp', 'replay-ten-dal']);
    expect((await down.getGame('replay-ten-dal'))?.sport).toBe('nfl');
    const feed = await down.open('replay-por-esp', () => undefined);
    expect(feed.control).toBeDefined();
    feed.stop();

    const up = new CompositeSportsAdapter(new EspnAdapter({ soccerLeagues: [], fetch: fakeFetch({ 'football/nfl/scoreboard': nflScoreboard }) }), replay);
    const ids = (await up.listGames()).map((g) => g.id);
    expect(ids.slice(0, 2).sort()).toEqual(['replay-por-esp', 'replay-ten-dal']);
    expect(ids).toContain('espn:nfl:401873065');
    expect((await up.listGames('soccer')).map((g) => g.id)).toEqual(['replay-por-esp']);
  });
});
