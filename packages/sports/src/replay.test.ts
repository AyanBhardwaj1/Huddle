import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameEvent } from '@huddle/shared';
import { buildTimeline, createReplayFeed, loadTimelines, ReplayAdapter, resolveReplayDir, type ReplayFile, type Timeline } from './replay';
import { reduce } from './reduce';

const timelines = loadTimelines(resolveReplayDir());
const soccer = timelines.find((t) => t.info.id === 'replay-por-esp')!;
const nfl = timelines.find((t) => t.info.id === 'replay-ten-dal')!;

function tiny(): Timeline {
  const file: ReplayFile = {
    id: 'tiny',
    sport: 'soccer',
    title: 'Tiny',
    home: { name: 'Home', short: 'HOM' },
    away: { name: 'Away', short: 'AWY' },
    durationMs: 10_000,
    events: [
      { atMs: 1000, type: 'kickoff', period: 1, minute: 0 },
      { atMs: 3000, type: 'goal', minute: 10, team: 'HOM' },
      { atMs: 5000, type: 'card', minute: 20, team: 'AWY', data: { color: 'yellow' } },
      { atMs: 7000, type: 'goal', minute: 30, team: 'AWY' },
      { atMs: 9000, type: 'final', minute: 90 },
    ],
  };
  return buildTimeline(file);
}

describe('replay timelines on disk', () => {
  it('loads both demo timelines with normalized events', () => {
    expect(timelines.map((t) => t.info.id).sort()).toEqual(['replay-por-esp', 'replay-ten-dal']);
    for (const t of timelines) {
      expect(t.info.status).toBe('replay');
      expect(t.info.source).toBe('replay');
      t.events.forEach((e, i) => {
        expect(e.event.seq).toBe(i + 1);
        expect(e.event.gameId).toBe(t.info.id);
        if (i > 0) expect(e.atMs).toBeGreaterThanOrEqual(t.events[i - 1]!.atMs);
      });
      expect(t.events[0]!.event.type).toBe('kickoff');
      expect(t.events[t.events.length - 1]!.event.type).toBe('final');
      expect(t.info.durationMs).toBeGreaterThanOrEqual(t.events[t.events.length - 1]!.atMs);
    }
  });

  it('soccer: Portugal vs Spain has the pitch moments in demo time', () => {
    expect(soccer.info.title).toBe('Portugal vs Spain');
    // 6 to 7 minutes at 1x.
    expect(soccer.info.durationMs).toBeGreaterThanOrEqual(6 * 60_000);
    expect(soccer.info.durationMs).toBeLessThanOrEqual(7 * 60_000);
    const at = (pred: (e: Timeline['events'][number]) => boolean): Timeline['events'][number][] => soccer.events.filter(pred);

    const awarded = at((e) => e.event.type === 'penalty_awarded')[0]!;
    const result = at((e) => e.event.type === 'penalty_result')[0]!;
    expect(awarded.event.team).toBe('POR');
    expect(awarded.event.player).toBe('Ronaldo');
    expect(awarded.atMs).toBeLessThanOrEqual(45_000);
    expect(result.atMs - awarded.atMs).toBeGreaterThanOrEqual(25_000);
    expect(result.atMs - awarded.atMs).toBeLessThanOrEqual(30_000);
    expect(typeof result.event.data.scored).toBe('boolean');

    expect(at((e) => e.event.type === 'goal').length).toBeGreaterThanOrEqual(5);
    expect(at((e) => e.event.type === 'card' && e.event.data.color === 'yellow').length).toBeGreaterThanOrEqual(2);
    const awards = at((e) => e.event.type === 'corner' && typeof e.event.data.shotOnTarget !== 'boolean');
    const outcomes = at((e) => e.event.type === 'corner' && typeof e.event.data.shotOnTarget === 'boolean');
    expect(awards.length).toBeGreaterThanOrEqual(3);
    expect(outcomes.length).toBe(awards.length);
    expect(outcomes.some((o) => o.event.data.shotOnTarget === true)).toBe(true);
    expect(outcomes.some((o) => o.event.data.shotOnTarget === false)).toBe(true);
    // Every corner leaves 20+ s of demo time before its outcome.
    awards.forEach((a, i) => expect(outcomes[i]!.atMs - a.atMs).toBeGreaterThanOrEqual(20_000));
    expect(at((e) => e.event.type === 'period_end' && e.event.data.period === 1)).toHaveLength(1);
    expect(at((e) => e.event.data.minute === 60).length).toBeGreaterThanOrEqual(1);
    expect(at((e) => e.event.data.minute === 80).length).toBeGreaterThanOrEqual(1);
    expect(soccer.events.every((e) => e.event.type === 'drive_end' || typeof e.event.text === 'string')).toBe(true);
    expect(soccer.events[soccer.events.length - 1]!.event.score).toEqual({ home: 4, away: 3 });
  });

  it('NFL: Titans at Cowboys has snaps with room to bet, a red-zone TD, a field goal and quarters', () => {
    expect(nfl.info.home.short).toBe('DAL');
    expect(nfl.info.away.short).toBe('TEN');
    expect(nfl.info.durationMs).toBeGreaterThanOrEqual(4 * 60_000);
    expect(nfl.info.durationMs).toBeLessThanOrEqual(5.25 * 60_000);

    const snaps = nfl.events.filter((e) => e.event.type === 'snap');
    expect(snaps.length).toBeGreaterThanOrEqual(4);
    expect(snaps.some((s) => s.event.data.down === 4)).toBe(true);
    for (const snap of snaps) {
      const idx = nfl.events.indexOf(snap);
      const result = nfl.events[idx + 1]!;
      expect(result.event.type).toBe('play_result');
      expect(result.event.data.down).toBe(snap.event.data.down);
      expect(result.event.data.distance).toBe(snap.event.data.distance);
      expect(result.atMs - snap.atMs).toBeGreaterThanOrEqual(20_000);
    }
    expect(nfl.events.filter((e) => e.event.type === 'drive_start').length).toBeGreaterThanOrEqual(3);
    const results = nfl.events.filter((e) => e.event.type === 'drive_end').map((e) => e.event.data.result);
    expect(results).toContain('td');
    expect(results).toContain('fg');
    expect(nfl.events.filter((e) => e.event.type === 'period_end').map((e) => e.event.data.period)).toEqual([1, 2, 3, 4]);
    // A red-zone play precedes a touchdown on the same drive.
    const td = nfl.events.find((e) => e.event.data.touchdown === true)!;
    expect(Number(td.event.data.yardline)).toBeGreaterThanOrEqual(80);
    // secondsRemaining is filled in and never increases.
    let last = 3600;
    for (const e of nfl.events) {
      const secs = e.event.data.secondsRemaining as number;
      expect(typeof secs).toBe('number');
      expect(secs).toBeLessThanOrEqual(last);
      last = secs;
    }
    expect(nfl.events[nfl.events.length - 1]!.event.score).toEqual({ home: 14, away: 9 });
  });

  it('NFL yardlines and downs are internally consistent', () => {
    let expected: { down: number; distance: number; yardline: number } | undefined;
    for (const { event: e } of nfl.events) {
      if (e.type === 'drive_start') expected = { down: 1, distance: 10, yardline: e.data.yardline as number };
      if (e.type === 'snap' && expected) {
        expect({ down: e.data.down, distance: e.data.distance, yardline: e.data.yardline }).toEqual(expected);
      }
      if (e.type === 'play_result') {
        const d = e.data as { down: number; distance: number; yardline: number; gained: number; firstDown: boolean; touchdown?: boolean; playType: string };
        if (expected) expect({ down: d.down, distance: d.distance, yardline: d.yardline }).toEqual(expected);
        expect(d.firstDown).toBe(d.gained >= d.distance && d.playType !== 'kick');
        if (d.touchdown) expect(d.yardline + d.gained).toBe(100);
        const spot = d.yardline + d.gained;
        expected = d.touchdown || d.playType === 'kick' ? undefined : d.firstDown ? { down: 1, distance: Math.min(10, 100 - spot), yardline: spot } : { down: d.down + 1, distance: d.distance - d.gained, yardline: spot };
      }
      if (e.type === 'drive_end') expected = undefined;
    }
  });

  it('skips bad files instead of throwing', () => {
    const warnings: string[] = [];
    expect(loadTimelines('/definitely/not/a/folder', (m) => warnings.push(m))).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(() => buildTimeline({ id: 'x', sport: 'soccer', title: 'x', home: { name: 'A', short: 'A' }, away: { name: 'B', short: 'B' }, events: [] })).toThrow(/no events/);
  });
});

describe('replay feed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function open(t: Timeline = tiny()): { got: GameEvent[]; feed: ReturnType<typeof createReplayFeed> } {
    const got: GameEvent[] = [];
    const feed = createReplayFeed(t, (e) => got.push(e));
    return { got, feed };
  }

  it('is created paused and plays events in seq order with wall-clock timestamps', () => {
    const { got, feed } = open();
    vi.advanceTimersByTime(5000);
    expect(got).toHaveLength(0);
    expect(feed.control.status()).toMatchObject({ playing: false, positionMs: 0, seq: 0, totalEvents: 5, speed: 1, durationMs: 10_000 });

    feed.control.start();
    vi.advanceTimersByTime(999);
    expect(got).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(got.map((e) => e.seq)).toEqual([1]);
    expect(got[0]!.ts).toBe('2026-11-16T12:00:06.000Z');
    vi.advanceTimersByTime(2500);
    expect(got.map((e) => e.type)).toEqual(['kickoff', 'goal']);
    expect(got[1]!.score).toEqual({ home: 1, away: 0 });
    expect(feed.control.status()).toMatchObject({ playing: true, positionMs: 3500, seq: 2 });
  });

  it('pause freezes the position and start resumes from it', () => {
    const { got, feed } = open();
    feed.control.start();
    vi.advanceTimersByTime(2000);
    feed.control.pause();
    vi.advanceTimersByTime(60_000);
    expect(got).toHaveLength(1);
    expect(feed.control.status()).toMatchObject({ playing: false, positionMs: 2000 });
    feed.control.start();
    vi.advanceTimersByTime(1000);
    expect(got.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('supports 0.25x to 20x and clamps outside that range', () => {
    const { got, feed } = open();
    feed.control.setSpeed(20);
    feed.control.start();
    vi.advanceTimersByTime(450); // 9000 ms of replay
    expect(got).toHaveLength(5);
    expect(feed.control.status().playing).toBe(false);

    const slow = open();
    slow.feed.control.setSpeed(0.25);
    slow.feed.control.start();
    vi.advanceTimersByTime(3999);
    expect(slow.got).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(slow.got).toHaveLength(1);

    slow.feed.control.setSpeed(1000);
    expect(slow.feed.control.status().speed).toBe(20);
    slow.feed.control.setSpeed(0.001);
    expect(slow.feed.control.status().speed).toBe(0.25);
    slow.feed.control.setSpeed(Number.NaN);
    expect(slow.feed.control.status().speed).toBe(1);
  });

  it('changing speed mid-flight keeps the position continuous', () => {
    const { got, feed } = open();
    feed.control.start();
    vi.advanceTimersByTime(2000); // pos 2000
    feed.control.setSpeed(4);
    vi.advanceTimersByTime(250); // pos 3000
    expect(got.map((e) => e.seq)).toEqual([1, 2]);
    expect(feed.control.status().positionMs).toBe(3000);
  });

  it('seek forward delivers each skipped event once, flagged as catch-up', () => {
    const { got, feed } = open();
    feed.control.start();
    vi.advanceTimersByTime(1500);
    feed.control.seek(6000);
    expect(got.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(got.map((e) => e.data.catchUp === true)).toEqual([false, true, true]);
    vi.advanceTimersByTime(10_000);
    expect(got.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(got.map((e) => e.seq)).size).toBe(5);
    expect(got[3]!.data.catchUp).toBeUndefined();
  });

  it('seek works while paused and does not start playback', () => {
    const { got, feed } = open();
    feed.control.seek(3500);
    expect(got.map((e) => e.seq)).toEqual([1, 2]);
    vi.advanceTimersByTime(60_000);
    expect(got).toHaveLength(2);
    expect(feed.control.status()).toMatchObject({ playing: false, positionMs: 3500, seq: 2 });
  });

  it('seek backward rewinds: the prefix is replayed from seq 1 and reduce() rebuilds cleanly', () => {
    const t = tiny();
    const { got, feed } = open(t);
    let state = initialGameState(t.info.id, 'soccer', t.info.home, t.info.away);
    feed.control.start();
    vi.advanceTimersByTime(8000);
    for (const e of got) state = reduce(state, e);
    expect(state.score).toEqual({ home: 1, away: 1 });
    expect(state.counters.cards_total).toBe(1);

    const before = got.length;
    feed.control.seek(4000);
    const replayed = got.slice(before);
    expect(replayed.map((e) => e.seq)).toEqual([1, 2]);
    expect(replayed.every((e) => e.data.catchUp === true)).toBe(true);
    for (const e of replayed) state = reduce(state, e);
    expect(state.score).toEqual({ home: 1, away: 0 });
    expect(state.counters.cards_total ?? 0).toBe(0);
    expect(state.lastSeq).toBe(2);

    vi.advanceTimersByTime(1000);
    expect(got[got.length - 1]!.seq).toBe(3);
    expect(got[got.length - 1]!.data.catchUp).toBeUndefined();

    feed.control.seek(0);
    expect(feed.control.status()).toMatchObject({ positionMs: 0, seq: 0 });
  });

  it('pauses itself after the last event and stop() ends the feed', () => {
    const { got, feed } = open();
    feed.control.start();
    vi.advanceTimersByTime(20_000);
    expect(got).toHaveLength(5);
    expect(feed.control.status()).toMatchObject({ playing: false, seq: 5 });

    const other = open();
    other.feed.control.start();
    vi.advanceTimersByTime(1500);
    other.feed.stop();
    vi.advanceTimersByTime(20_000);
    other.feed.control.start();
    vi.advanceTimersByTime(20_000);
    expect(other.got).toHaveLength(1);
  });

  it('the adapter lists replays as games and opens a paused feed with controls', async () => {
    const adapter = new ReplayAdapter(resolveReplayDir());
    expect(adapter.provider).toBe('replay');
    expect((await adapter.listGames()).map((g) => g.id).sort()).toEqual(['replay-por-esp', 'replay-ten-dal']);
    expect((await adapter.listGames('nfl')).map((g) => g.id)).toEqual(['replay-ten-dal']);
    expect((await adapter.getGame('replay-por-esp'))?.title).toBe('Portugal vs Spain');
    expect(await adapter.getGame('nope')).toBeUndefined();
    await expect(adapter.open('nope', () => undefined)).rejects.toThrow(/unknown replay/);

    const got: GameEvent[] = [];
    const feed = await adapter.open('replay-por-esp', (e) => got.push(e));
    expect(feed.control).toBeDefined();
    expect(feed.control!.status().playing).toBe(false);
    feed.control!.setSpeed(20);
    feed.control!.start();
    vi.advanceTimersByTime(25_000);
    expect(got).toHaveLength(soccer.events.length);
    expect(got.map((e) => e.seq)).toEqual(soccer.events.map((e) => e.event.seq));
    feed.stop();
  });
});
