import type { GameEvent, GameEventType, GameState } from '../events';
import type { GameFeed, ReplayControl, SportsAdapter } from '../interfaces';
import type { GameInfo, ReplayStatus, Sport } from '../types';

const GAME: GameInfo = {
  id: 'mock-soccer',
  sport: 'soccer',
  title: 'Portugal vs Spain (mock)',
  home: { name: 'Portugal', short: 'POR', color: '#C8102E' },
  away: { name: 'Spain', short: 'ESP', color: '#F1BF00' },
  status: 'replay',
  source: 'mock',
  durationMs: 60_000,
};

type Row = [atMs: number, type: GameEventType, minute: number, team?: string, player?: string, data?: Record<string, unknown>];

/** A one-minute toy match: kickoff, penalty, goals, a card and full time. */
const ROWS: Row[] = [
  [1_000, 'kickoff', 0],
  [8_000, 'card', 12, 'ESP', 'Rodri', { color: 'yellow' }],
  [14_000, 'penalty_awarded', 23, 'POR', 'Ronaldo'],
  [26_000, 'penalty_result', 24, 'POR', 'Ronaldo', { scored: true }],
  [26_500, 'goal', 24, 'POR', 'Ronaldo'],
  [34_000, 'period_end', 45, undefined, undefined, { period: 1 }],
  [36_000, 'period_start', 45, undefined, undefined, { period: 2 }],
  [44_000, 'goal', 67, 'ESP', 'Yamal'],
  [52_000, 'goal', 81, 'POR', 'Leão'],
  [58_000, 'period_end', 90, undefined, undefined, { period: 2 }],
  [59_000, 'final', 90],
];

function buildTimeline(): { atMs: number; event: Omit<GameEvent, 'ts'> }[] {
  const score = { home: 0, away: 0 };
  return ROWS.map(([atMs, type, minute, team, player, data], i) => {
    if (type === 'goal') {
      if (team === GAME.home.short) score.home++;
      else score.away++;
    }
    return {
      atMs,
      event: {
        gameId: GAME.id,
        sport: 'soccer' as const,
        seq: i + 1,
        clock: { period: minute > 45 || (minute === 45 && type === 'period_start') ? 2 : 1, display: `${minute}'` },
        type,
        team,
        player,
        data: { minute, ...data },
        score: { ...score },
      },
    };
  });
}

/** Minimal reducer; the real one lives in @huddle/sports. */
export function mockReduce(state: GameState, e: GameEvent): GameState {
  const next: GameState = {
    ...state,
    score: { ...e.score },
    clock: e.clock,
    lastSeq: e.seq,
    lastEvent: e,
    counters: { ...state.counters },
    periodScores: [...state.periodScores],
  };
  const minute = e.data.minute;
  if (typeof minute === 'number') next.minute = minute;
  if (e.type === 'kickoff') next.status = 'live';
  if (e.type === 'final') next.status = 'final';
  if (e.type === 'card') next.counters.cards_total = (next.counters.cards_total ?? 0) + 1;
  if (e.type === 'period_end') {
    next.periodScores.push({ period: Number(e.data.period ?? e.clock.period), home: e.score.home, away: e.score.away });
  }
  return next;
}

export class MockSportsAdapter implements SportsAdapter {
  readonly provider = 'mock' as const;

  async listGames(sport?: Sport): Promise<GameInfo[]> {
    return !sport || sport === 'soccer' ? [GAME] : [];
  }

  async getGame(gameId: string): Promise<GameInfo | undefined> {
    return gameId === GAME.id ? GAME : undefined;
  }

  reduce(state: GameState, event: GameEvent): GameState {
    return mockReduce(state, event);
  }

  async open(gameId: string, onEvent: (e: GameEvent) => void): Promise<GameFeed> {
    if (gameId !== GAME.id) throw new Error(`unknown game ${gameId}`);
    const timeline = buildTimeline();
    let positionMs = 0;
    let speed = 1;
    let playing = false;
    let nextIdx = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let last = 0;

    const tick = (): void => {
      const now = Date.now();
      positionMs += (now - last) * speed;
      last = now;
      while (nextIdx < timeline.length && timeline[nextIdx]!.atMs <= positionMs) {
        onEvent({ ...timeline[nextIdx]!.event, ts: new Date().toISOString() });
        nextIdx++;
      }
      if (nextIdx >= timeline.length) control.pause();
    };

    const control: ReplayControl = {
      start() {
        if (playing) return;
        playing = true;
        last = Date.now();
        timer = setInterval(tick, 50);
      },
      pause() {
        playing = false;
        if (timer) clearInterval(timer);
        timer = null;
      },
      seek(ms: number) {
        positionMs = ms;
        nextIdx = timeline.findIndex((t) => t.atMs > ms);
        if (nextIdx < 0) nextIdx = timeline.length;
      },
      setSpeed(s: number) {
        speed = s;
      },
      status(): ReplayStatus {
        return {
          gameId,
          playing,
          speed,
          positionMs: Math.round(positionMs),
          durationMs: GAME.durationMs!,
          seq: nextIdx,
          totalEvents: timeline.length,
        };
      },
    };

    return { info: GAME, control, stop: () => control.pause() };
  }
}
