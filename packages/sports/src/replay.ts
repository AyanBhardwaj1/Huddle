import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  GameEvent,
  GameEventType,
  GameFeed,
  GameInfo,
  GameState,
  ReplayControl,
  ReplayStatus,
  Sport,
  SportsAdapter,
  TeamRef,
} from '@huddle/shared';
import { nflSecondsRemaining, reduce } from './reduce';

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 20;

const EVENT_TYPES: ReadonlySet<string> = new Set<GameEventType>([
  'kickoff',
  'goal',
  'penalty_awarded',
  'penalty_result',
  'corner',
  'card',
  'sub',
  'snap',
  'play_result',
  'drive_start',
  'drive_end',
  'period_start',
  'period_end',
  'final',
  'score_update',
]);

/** One timeline entry as written in `replays/*.json` (see replays/README.md). */
export interface ReplayEntry {
  /** Demo time in ms from the start of the replay at 1x. */
  atMs: number;
  type: GameEventType;
  /** Period number. Defaults to the previous entry's period (1 at the start). */
  period?: number;
  /** Soccer: elapsed match minute. Sets `data.minute` and the clock display ("23'"). */
  minute?: number;
  /** Clock display override; for NFL a "MM:SS" game clock, which also sets `data.secondsRemaining`. */
  clock?: string;
  team?: string;
  player?: string;
  data?: Record<string, unknown>;
  /** Score after this event as [home, away]. Omitted = carried forward (soccer goals add one automatically). */
  score?: [number, number];
  text?: string;
}

export interface ReplayFile {
  id: string;
  sport: Sport;
  title: string;
  home: TeamRef;
  away: TeamRef;
  /** Replay length in ms at 1x. Defaults to the last event + 3 s. */
  durationMs?: number;
  videoUrl?: string;
  startsAt?: string;
  description?: string;
  events: ReplayEntry[];
}

export interface Timeline {
  info: GameInfo;
  /** Fully normalized events (without `ts`), in seq order. */
  events: { atMs: number; event: Omit<GameEvent, 'ts'> }[];
}

/** Timer hooks so tests can drive the feed deterministically. Defaults to the globals. */
export interface ReplayClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: ReplayClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Validate and normalize one replay file. Throws with a readable message on bad input. */
export function buildTimeline(file: ReplayFile): Timeline {
  if (!file || typeof file !== 'object') throw new Error('replay file is not an object');
  if (!file.id || typeof file.id !== 'string') throw new Error('replay file needs an "id"');
  if (file.sport !== 'soccer' && file.sport !== 'nfl') throw new Error(`replay ${file.id}: sport must be soccer or nfl`);
  if (!file.home?.short || !file.away?.short) throw new Error(`replay ${file.id}: home/away need name and short`);
  if (!Array.isArray(file.events) || file.events.length === 0) throw new Error(`replay ${file.id}: no events`);

  const entries = file.events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.atMs - b.e.atMs || a.i - b.i)
    .map((x) => x.e);

  const score = { home: 0, away: 0 };
  let period = 1;
  let minute = 0;
  let display = file.sport === 'soccer' ? "0'" : '15:00';
  const events: Timeline['events'] = [];

  entries.forEach((entry, idx) => {
    if (typeof entry.atMs !== 'number' || entry.atMs < 0) throw new Error(`replay ${file.id}: event ${idx} has no atMs`);
    if (!EVENT_TYPES.has(entry.type)) throw new Error(`replay ${file.id}: event ${idx} has unknown type "${entry.type}"`);
    if (typeof entry.period === 'number') period = entry.period;
    const data: Record<string, unknown> = { ...(entry.data ?? {}) };

    if (file.sport === 'soccer') {
      if (typeof entry.minute === 'number') minute = entry.minute;
      else if (typeof data.minute === 'number') minute = data.minute;
      data.minute = minute;
      display = entry.clock ?? `${minute}'`;
    } else {
      if (entry.clock) display = entry.clock;
      if (typeof data.secondsRemaining !== 'number') {
        const secs = entry.type === 'final' ? 0 : nflSecondsRemaining(period, display);
        if (secs !== undefined) data.secondsRemaining = secs;
      }
    }
    if ((entry.type === 'period_start' || entry.type === 'period_end') && data.period === undefined) data.period = period;

    if (entry.score) {
      score.home = entry.score[0];
      score.away = entry.score[1];
    } else if (file.sport === 'soccer' && entry.type === 'goal') {
      const t = entry.team?.toUpperCase();
      if (t === file.home.short.toUpperCase()) score.home += 1;
      else if (t === file.away.short.toUpperCase()) score.away += 1;
      else throw new Error(`replay ${file.id}: goal at ${entry.atMs} ms has no valid team`);
    }

    const event: Omit<GameEvent, 'ts'> = {
      gameId: file.id,
      sport: file.sport,
      seq: idx + 1,
      clock: { period, display },
      type: entry.type,
      data,
      score: { ...score },
    };
    if (entry.team) event.team = entry.team;
    if (entry.player) event.player = entry.player;
    if (entry.text) event.text = entry.text;
    events.push({ atMs: entry.atMs, event });
  });

  const lastAt = events[events.length - 1]!.atMs;
  const info: GameInfo = {
    id: file.id,
    sport: file.sport,
    title: file.title ?? `${file.home.name} vs ${file.away.name}`,
    home: file.home,
    away: file.away,
    status: 'replay',
    source: 'replay',
    durationMs: Math.max(file.durationMs ?? 0, lastAt + (file.durationMs ? 0 : 3000)),
  };
  if (file.videoUrl) info.videoUrl = file.videoUrl;
  if (file.startsAt) info.startsAt = file.startsAt;
  return { info, events };
}

/** Folder holding the replay timelines: `REPLAY_DIR`, else `<repo>/replays` relative to this package. */
export function resolveReplayDir(env: Record<string, string | undefined> = {}): string {
  if (env.REPLAY_DIR) return env.REPLAY_DIR;
  return fileURLToPath(new URL('../../../replays/', import.meta.url));
}

/** Load every `*.json` timeline in a folder. Bad files are skipped with a warning, never thrown. */
export function loadTimelines(dir: string, warn: (msg: string) => void = (m) => console.warn(m)): Timeline[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch (err) {
    warn(`[sports] replay folder ${dir} is not readable: ${(err as Error).message}`);
    return [];
  }
  const out: Timeline[] = [];
  for (const name of names) {
    try {
      const file = JSON.parse(readFileSync(join(dir, name), 'utf8')) as ReplayFile;
      const timeline = buildTimeline(file);
      if (out.some((t) => t.info.id === timeline.info.id)) throw new Error(`duplicate replay id ${timeline.info.id}`);
      out.push(timeline);
    } catch (err) {
      warn(`[sports] skipping replay ${name}: ${(err as Error).message}`);
    }
  }
  return out;
}

/**
 * Play one timeline as a feed.
 *
 * Semantics (also in replays/README.md):
 *  - Created paused at position 0. `start()` runs the replay clock at `speed` x wall time.
 *  - Events are delivered in `seq` order, each exactly once per pass, with `ts` = wall clock at delivery.
 *  - `setSpeed` clamps to 0.25..20 and takes effect immediately, playing or paused.
 *  - `seek(forward)`: every not-yet-delivered event up to the new position is delivered at once, in
 *    order, flagged `data.catchUp = true`. Nothing is delivered twice.
 *  - `seek(backward)`: the feed rewinds to the top and immediately re-delivers events 1..k (those at or
 *    before the new position), flagged `data.catchUp = true`. Consumers see `seq` restart at 1;
 *    `reduce()` rebuilds its state when that happens. Seeking to 0 delivers nothing.
 *  - After the last event the feed pauses itself. `stop()` ends the feed for good.
 */
export function createReplayFeed(
  timeline: Timeline,
  onEvent: (e: GameEvent) => void,
  clock: ReplayClock = systemClock,
): GameFeed & { control: ReplayControl } {
  const { events, info } = timeline;
  const durationMs = info.durationMs ?? (events[events.length - 1]?.atMs ?? 0);
  let basePos = 0; // replay position at `baseWall`
  let baseWall = 0;
  let speed = 1;
  let playing = false;
  let stopped = false;
  let cursor = 0; // index of the next event to deliver
  let timer: unknown = null;
  let delivering = false;

  const position = (): number => {
    if (!playing) return basePos;
    return Math.min(durationMs, basePos + (clock.now() - baseWall) * speed);
  };

  const clear = (): void => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  const deliverUpTo = (pos: number, catchUp: boolean): void => {
    if (delivering) return;
    delivering = true;
    try {
      while (!stopped && cursor < events.length && events[cursor]!.atMs <= pos) {
        const { event } = events[cursor]!;
        cursor++;
        const out: GameEvent = {
          ...event,
          ts: new Date(clock.now()).toISOString(),
          data: catchUp ? { ...event.data, catchUp: true } : { ...event.data },
          score: { ...event.score },
          clock: { ...event.clock },
        };
        try {
          onEvent(out);
        } catch (err) {
          console.error('[sports] replay listener threw', err);
        }
      }
    } finally {
      delivering = false;
    }
  };

  const schedule = (): void => {
    clear();
    if (!playing || stopped) return;
    const pos = position();
    const next = events[cursor];
    const target = next ? next.atMs : durationMs;
    if (!next && pos >= durationMs) {
      basePos = durationMs;
      playing = false;
      return;
    }
    const delay = Math.max(0, Math.ceil((target - pos) / speed));
    timer = clock.setTimeout(tick, delay);
  };

  const tick = (): void => {
    timer = null;
    if (!playing || stopped) return;
    // Guard against timer rounding: anything within 1 ms of replay time is due.
    deliverUpTo(position() + 1e-6 + speed, false);
    if (cursor >= events.length) {
      basePos = Math.max(position(), events[events.length - 1]?.atMs ?? 0);
      playing = false;
      clear();
      return;
    }
    schedule();
  };

  const rebase = (): void => {
    basePos = position();
    baseWall = clock.now();
  };

  const control: ReplayControl = {
    start() {
      if (playing || stopped) return;
      if (cursor >= events.length && basePos >= (events[events.length - 1]?.atMs ?? 0)) return; // finished
      baseWall = clock.now();
      playing = true;
      deliverUpTo(basePos, false);
      schedule();
    },
    pause() {
      if (!playing) return;
      rebase();
      playing = false;
      clear();
    },
    seek(positionMs: number) {
      if (stopped) return;
      const target = Math.min(durationMs, Math.max(0, Number.isFinite(positionMs) ? positionMs : 0));
      const current = position();
      if (target < current) cursor = 0; // rewind: replay the prefix from seq 1
      basePos = target;
      baseWall = clock.now();
      deliverUpTo(target, true);
      schedule();
    },
    setSpeed(s: number) {
      const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number.isFinite(s) && s > 0 ? s : 1));
      rebase();
      speed = clamped;
      schedule();
    },
    status(): ReplayStatus {
      return {
        gameId: info.id,
        playing,
        speed,
        positionMs: Math.round(position()),
        durationMs,
        seq: cursor,
        totalEvents: events.length,
      };
    },
  };

  return {
    info,
    control,
    stop() {
      rebase();
      playing = false;
      stopped = true;
      clear();
    },
  };
}

/** Replay adapter (PRD section 11, P0): every `replays/*.json` timeline is a game. */
export class ReplayAdapter implements SportsAdapter {
  readonly provider = 'replay' as const;
  private timelines: Timeline[] | null = null;

  constructor(
    private readonly dir: string = resolveReplayDir(),
    private readonly clock: ReplayClock = systemClock,
  ) {}

  /** Parsed timelines (loaded once). */
  all(): Timeline[] {
    if (!this.timelines) this.timelines = loadTimelines(this.dir);
    return this.timelines;
  }

  async listGames(sport?: Sport): Promise<GameInfo[]> {
    return this.all()
      .map((t) => t.info)
      .filter((g) => !sport || g.sport === sport);
  }

  async getGame(gameId: string): Promise<GameInfo | undefined> {
    return this.all().find((t) => t.info.id === gameId)?.info;
  }

  async open(gameId: string, onEvent: (e: GameEvent) => void): Promise<GameFeed> {
    const timeline = this.all().find((t) => t.info.id === gameId);
    if (!timeline) throw new Error(`unknown replay game ${gameId}`);
    return createReplayFeed(timeline, onEvent, this.clock);
  }

  reduce(state: GameState, event: GameEvent): GameState {
    return reduce(state, event);
  }
}
