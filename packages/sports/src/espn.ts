import type { GameEvent, GameFeed, GameInfo, GameState, Sport, SportsAdapter, TeamRef } from '@huddle/shared';
import { arr, createPollingFeed, getJson, numMaybe, numOr, obj, str, type FetchLike, type KeyedEvent } from './live';
import { nflSecondsRemaining, reduce } from './reduce';

/**
 * ESPN public JSON (unofficial, undocumented; PRD section 11, P1).
 *   scoreboard: {base}/football/nfl/scoreboard, {base}/soccer/{league}/scoreboard
 *   summary:    {base}/football/nfl/summary?event={id}, {base}/soccer/{league}/summary?event={id}
 * Shapes were checked against live responses on 2026-11-16 (trimmed copies in src/__fixtures__).
 * Everything is parsed defensively: a missing field drops that one event, never the feed.
 */
export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
export const DEFAULT_SOCCER_LEAGUES = ['eng.1', 'esp.1', 'uefa.champions', 'usa.1'];

interface Teams {
  home: TeamRef;
  away: TeamRef;
  /** ESPN team id -> short code. */
  byId: Map<string, string>;
  /** Lowercased display name -> short code. */
  byName: Map<string, string>;
}

function teamsFromCompetitors(competitors: unknown): Teams | undefined {
  let home: TeamRef | undefined;
  let away: TeamRef | undefined;
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of arr(competitors)) {
    const co = obj(c);
    const team = obj(co.team);
    const short = str(team.abbreviation);
    const name = str(team.displayName) ?? str(team.name) ?? short;
    if (!short || !name) continue;
    const ref: TeamRef = { name, short };
    const color = str(team.color);
    if (color) ref.color = color.startsWith('#') ? color : `#${color}`;
    const id = str(team.id) ?? str(co.id);
    if (id) byId.set(id, short);
    for (const n of [team.displayName, team.name, team.shortDisplayName]) {
      const s = str(n);
      if (s) byName.set(s.toLowerCase(), short);
    }
    if (co.homeAway === 'home') home = ref;
    else if (co.homeAway === 'away') away = ref;
  }
  return home && away ? { home, away, byId, byName } : undefined;
}

function statusOf(state: unknown): GameInfo['status'] {
  return state === 'in' ? 'live' : state === 'post' ? 'final' : 'scheduled';
}

/** Map a scoreboard payload to games. `leaguePath` is `nfl` or `soccer:{league}`. */
export function mapEspnScoreboard(payload: unknown, sport: Sport, leaguePath: string): GameInfo[] {
  const out: GameInfo[] = [];
  for (const e of arr(obj(payload).events)) {
    const ev = obj(e);
    const id = str(ev.id);
    const comp = obj(arr(ev.competitions)[0]);
    const teams = teamsFromCompetitors(comp.competitors);
    if (!id || !teams) continue;
    const status = obj(obj(ev.status).type ?? obj(comp.status).type);
    const info: GameInfo = {
      id: `espn:${leaguePath}:${id}`,
      sport,
      title: sport === 'nfl' ? `${teams.away.name} at ${teams.home.name}` : `${teams.home.name} vs ${teams.away.name}`,
      home: teams.home,
      away: teams.away,
      status: statusOf(status.state),
      source: 'espn',
    };
    const date = str(ev.date);
    if (date && !Number.isNaN(Date.parse(date))) info.startsAt = new Date(date).toISOString();
    out.push(info);
  }
  return out;
}

function isCompleted(summary: unknown): boolean {
  const comp = obj(arr(obj(obj(summary).header).competitions)[0]);
  const type = obj(obj(comp.status).type);
  return type.completed === true || type.state === 'post';
}

// ───────────────────────── NFL ─────────────────────────

type NflPlayKind = 'kickoff' | 'run' | 'pass' | 'punt' | 'kick' | 'penalty' | 'period_end' | 'skip';

function classifyNflPlay(typeText: string, text: string): NflPlayKind {
  const t = typeText.toLowerCase();
  if (/timeout|two-minute|coin toss/.test(t)) return 'skip';
  if (/end period|end of half|end of game|end of regulation|end of quarter/.test(t)) return 'period_end';
  if (/kickoff/.test(t)) return 'kickoff';
  if (/penalty/.test(t)) return 'penalty';
  if (/punt/.test(t)) return 'punt';
  if (/field goal/.test(t)) return 'kick';
  if (/pass|sack|interception/.test(t)) return 'pass';
  if (/rush/.test(t)) return 'run';
  if (/fumble/.test(t)) return /\bpass\b|sacked/i.test(text) ? 'pass' : 'run';
  return 'skip';
}

/** Map an NFL summary payload to the full ordered event list so far. Pure. */
export function mapEspnNflSummary(summary: unknown): { teams?: Teams; events: KeyedEvent[]; done: boolean } {
  const s = obj(summary);
  const comp = obj(arr(obj(s.header).competitions)[0]);
  const teams = teamsFromCompetitors(comp.competitors);
  const done = isCompleted(summary);
  if (!teams) return { events: [], done };

  const drivesObj = obj(s.drives);
  const drives = [...arr(drivesObj.previous)];
  const current = obj(drivesObj.current);
  if (str(current.id) && !drives.some((d) => str(obj(d).id) === str(current.id))) drives.push(current);

  const events: KeyedEvent[] = [];
  const score = { home: 0, away: 0 };
  let period = 1;
  let display = '15:00';
  const endedPeriods = new Set<number>();
  let kickedOff = false;

  const push = (e: Omit<KeyedEvent, 'score' | 'clock'> & { clock?: KeyedEvent['clock'] }): void => {
    const clock = e.clock ?? { period, display };
    const secs = nflSecondsRemaining(clock.period, clock.display);
    events.push({ ...e, clock, data: secs === undefined ? e.data : { secondsRemaining: secs, ...e.data }, score: { ...score } });
  };

  drives.forEach((d, driveIdx) => {
    const drive = obj(d);
    const driveId = str(drive.id) ?? `d${driveIdx}`;
    const offense = str(obj(drive.team).abbreviation);
    const offenseId = [...teams.byId.entries()].find(([, short]) => short === offense)?.[0];
    const plays = arr(drive.plays).map(obj);
    let started = false;

    const startDrive = (yardline: number | undefined): void => {
      if (started || !offense) return;
      started = true;
      push({ key: `drive:${driveId}:start`, type: 'drive_start', team: offense, data: yardline === undefined ? {} : { yardline } });
    };

    for (const play of plays) {
      const playId = str(play.id);
      if (!playId) continue;
      const typeText = str(obj(play.type).text) ?? '';
      const text = str(play.text) ?? '';
      const kind = classifyNflPlay(typeText, text);
      const playPeriod = numOr(obj(play.period).number, period);
      const playClock = str(obj(play.clock).displayValue) ?? display;

      if (playPeriod > period) {
        if (!endedPeriods.has(period)) {
          endedPeriods.add(period);
          push({ key: `period:${period}:end`, type: 'period_end', data: { period }, clock: { period, display: '0:00' } });
        }
        period = playPeriod;
        display = '15:00';
        push({ key: `period:${period}:start`, type: 'period_start', data: { period } });
      }
      period = playPeriod;
      display = playClock;

      const start = obj(play.start);
      const end = obj(play.end);
      const startDown = numOr(start.down, 0);
      const startYte = numMaybe(start.yardsToEndzone);
      const endDown = numOr(end.down, 0);
      const endYte = numMaybe(end.yardsToEndzone);
      const sameTeamAfter = str(obj(end.team).id) === undefined || str(obj(end.team).id) === (str(obj(start.team).id) ?? offenseId);
      const home = numMaybe(play.homeScore);
      const away = numMaybe(play.awayScore);

      if (kind === 'skip') continue;

      if (kind === 'period_end') {
        if (!endedPeriods.has(period)) {
          endedPeriods.add(period);
          push({ key: `period:${period}:end`, type: 'period_end', data: { period }, text: text || undefined });
        }
        continue;
      }

      if (kind === 'kickoff') {
        if (!kickedOff && events.length === 0) {
          kickedOff = true;
          push({ key: 'kickoff', type: 'kickoff', data: {}, text: text || undefined });
        }
        if (home !== undefined) score.home = home;
        if (away !== undefined) score.away = away;
        if (endDown >= 1 && endYte !== undefined) {
          startDrive(100 - endYte);
          push({ key: `play:${playId}:snap`, type: 'snap', team: offense, data: { down: endDown, distance: numOr(end.distance, 10), yardline: clampYard(100 - endYte) } });
        }
        continue;
      }

      if (startDown >= 1 && startYte !== undefined) startDrive(clampYard(100 - startYte));
      else startDrive(undefined);

      const scoring = play.scoringPlay === true;
      const touchdown = scoring && /touchdown/i.test(typeText);
      const turnover = play.isTurnover === true || /interception|fumble recovery \(opponent\)/i.test(typeText);
      const base: Record<string, unknown> = {
        down: startDown >= 1 ? startDown : undefined,
        distance: numMaybe(start.distance),
        yardline: startYte === undefined ? undefined : clampYard(100 - startYte),
      };
      if (home !== undefined) score.home = home;
      if (away !== undefined) score.away = away;

      if (kind === 'penalty') {
        push({ key: `play:${playId}`, type: 'play_result', team: offense, data: { ...base, noPlay: true, playType: 'penalty', gained: 0, firstDown: false }, text: text || undefined });
      } else {
        const kicked = kind === 'kick' || kind === 'punt';
        const firstDown = !kicked && !turnover && ((touchdown && !turnover) || (endDown === 1 && sameTeamAfter));
        const data: Record<string, unknown> = {
          ...base,
          playType: kind,
          gained: kicked ? 0 : numOr(play.statYardage, 0),
          firstDown,
        };
        if (touchdown) data.touchdown = true;
        if (turnover) data.turnover = true;
        if (kind === 'kick') {
          data.good = /good/i.test(typeText) && scoring;
          data.kickYards = numMaybe(play.statYardage);
        }
        push({ key: `play:${playId}`, type: 'play_result', team: offense, data, text: text || undefined });
      }

      // The next pre-snap situation, when the same offense keeps the ball.
      if (!touchdown && !turnover && kind !== 'kick' && kind !== 'punt' && endDown >= 1 && endDown <= 4 && endYte !== undefined && sameTeamAfter) {
        push({ key: `play:${playId}:snap`, type: 'snap', team: offense, data: { down: endDown, distance: numOr(end.distance, 10), yardline: clampYard(100 - endYte) } });
      }
    }

    const result = str(drive.result);
    const isLast = driveIdx === drives.length - 1;
    if (started && result && (!isLast || done)) {
      const r = /^td$|touchdown/i.test(result) ? 'td' : /^fg$|field goal/i.test(result) && !/miss/i.test(result) ? 'fg' : 'none';
      push({ key: `drive:${driveId}:end`, type: 'drive_end', team: offense, data: { result: r, providerResult: result } });
    }
  });

  if (done && events.length > 0) {
    // Trust the header for the final score.
    for (const c of arr(comp.competitors)) {
      const co = obj(c);
      const sc = numMaybe(co.score);
      if (sc === undefined) continue;
      if (co.homeAway === 'home') score.home = sc;
      if (co.homeAway === 'away') score.away = sc;
    }
    if (!endedPeriods.has(period)) push({ key: `period:${period}:end`, type: 'period_end', data: { period }, clock: { period, display: '0:00' } });
    push({ key: 'final', type: 'final', data: {}, clock: { period, display: '0:00' } });
  }

  return { teams, events, done };
}

function clampYard(v: number): number {
  return Math.min(99, Math.max(1, Math.round(v)));
}

// ───────────────────────── Soccer ─────────────────────────

function minuteOf(clock: Record<string, unknown>, fallback: number): number {
  const value = numMaybe(clock.value);
  if (value !== undefined) return Math.floor(value / 60);
  const m = /(\d+)/.exec(str(clock.displayValue) ?? '');
  return m ? Number(m[1]) : fallback;
}

/** Map a soccer summary payload (commentary, else keyEvents) to the full ordered event list so far. Pure. */
export function mapEspnSoccerSummary(summary: unknown): { teams?: Teams; events: KeyedEvent[]; done: boolean } {
  const s = obj(summary);
  const comp = obj(arr(obj(s.header).competitions)[0]);
  const teams = teamsFromCompetitors(comp.competitors);
  const done = isCompleted(summary);
  if (!teams) return { events: [], done };

  // `commentary` has every play (corners, shots, cards, goals) but not the kickoff / halftime /
  // full-time markers; those only exist in `keyEvents`. Walk the commentary in order and slot the
  // markers in. Text-only commentary lines (no `play`) borrow the line's own `time` as their clock.
  type Row = { play: Record<string, unknown>; text: string };
  const keyRows: Row[] = arr(s.keyEvents).map((k) => ({ play: obj(k), text: str(obj(k).text) ?? '' }));
  const commentary: Row[] = arr(s.commentary)
    .map(obj)
    .map((c) => {
      const play = obj(c.play);
      return { play: Object.keys(play).length > 0 ? play : { clock: c.time }, text: str(c.text) ?? str(play.text) ?? '' };
    });
  const typeOf = (r: Row): string => str(obj(r.play.type).type) ?? '';
  let rows: Row[] = keyRows;
  if (commentary.length > 0) {
    const ids = new Set(commentary.map((r) => str(r.play.id)).filter(Boolean));
    const markers = keyRows.filter((r) => !ids.has(str(r.play.id)));
    const kickoffRow = markers.find((r) => typeOf(r) === 'kickoff');
    const halftimeRow = markers.find((r) => typeOf(r) === 'halftime');
    const endRows = markers.filter((r) => /^end-|^full-time$/.test(typeOf(r)));
    rows = kickoffRow ? [kickoffRow] : [];
    let halftimeDone = !halftimeRow;
    for (const r of commentary) {
      if (!halftimeDone && (numOr(obj(r.play.period).number, 1) >= 2 || typeOf(r) === 'start-2nd-half')) {
        rows.push(halftimeRow!);
        halftimeDone = true;
      }
      rows.push(r);
    }
    if (!halftimeDone) rows.push(halftimeRow!);
    rows.push(...endRows);
  }

  const events: KeyedEvent[] = [];
  const score = { home: 0, away: 0 };
  let period = 1;
  let minute = 0;
  let pendingCorner: { id: string; team?: string; at: number } | undefined;
  const endedPeriods = new Set<number>();

  const shortFor = (name: string | undefined): string | undefined => (name ? teams.byName.get(name.toLowerCase()) : undefined);
  const otherShort = (short: string | undefined): string | undefined =>
    short === teams.home.short ? teams.away.short : short === teams.away.short ? teams.home.short : undefined;
  const push = (e: Omit<KeyedEvent, 'score' | 'clock' | 'data'> & { data?: Record<string, unknown>; display?: string }): void => {
    const { display, ...rest } = e;
    events.push({ ...rest, clock: { period, display: display ?? `${minute}'` }, data: { minute, ...(e.data ?? {}) }, score: { ...score } });
  };
  const settleCorner = (shotOnTarget: boolean): void => {
    if (!pendingCorner) return;
    push({ key: `play:${pendingCorner.id}:outcome`, type: 'corner', team: pendingCorner.team, data: { shotOnTarget } });
    pendingCorner = undefined;
  };

  rows.forEach((row, idx) => {
    const play = row.play;
    const type = str(obj(play.type).type) ?? '';
    const id = str(play.id) ?? `row${idx}`;
    const clock = obj(play.clock);
    const hasClock = numMaybe(clock.value) !== undefined || str(clock.displayValue) !== undefined;
    const p = numMaybe(obj(play.period).number);
    if (p !== undefined && p >= period) period = p;
    if (hasClock) minute = Math.max(minute, minuteOf(clock, minute));
    const at = numMaybe(clock.value) ?? minute * 60;
    const display = str(clock.displayValue) || `${minute}'`;
    const team = shortFor(str(obj(play.team).displayName));
    const player = str(obj(obj(arr(play.participants)[0]).athlete).displayName);
    const text = row.text || undefined;
    const isGoal = type.startsWith('goal') || type === 'own-goal' || type.startsWith('penalty---scored') || (play.scoringPlay === true && !type.includes('shootout'));
    const isShotOnTarget = type === 'shot-on-target' || isGoal;

    // Corner bookkeeping: a shot on target by the same team within 30 s settles it "yes"; anything
    // later, or the half ending, settles it "no".
    if (pendingCorner) {
      const within = at - pendingCorner.at <= 30;
      if (within && isShotOnTarget && (!team || !pendingCorner.team || team === pendingCorner.team)) settleCorner(true);
      else if (!within || type === 'halftime' || type === 'end-regular-time') settleCorner(false);
    }

    if (type === 'kickoff') {
      if (events.length === 0) push({ key: 'kickoff', type: 'kickoff', text, display: "0'" });
      return;
    }
    if (type === 'halftime') {
      if (!endedPeriods.has(1)) {
        endedPeriods.add(1);
        push({ key: 'period:1:end', type: 'period_end', data: { period: 1 }, text, display });
      }
      return;
    }
    if (type === 'start-2nd-half') {
      period = 2;
      minute = Math.max(minute, 45);
      push({ key: 'period:2:start', type: 'period_start', data: { period: 2 }, text });
      return;
    }
    if (type === 'end-regular-time' || type === 'end-match' || type === 'full-time') {
      if (!endedPeriods.has(period)) {
        endedPeriods.add(period);
        push({ key: `period:${period}:end`, type: 'period_end', data: { period }, text, display });
      }
      return;
    }

    if (type.startsWith('penalty---missed') || type.startsWith('penalty---saved')) {
      push({ key: `play:${id}:pen`, type: 'penalty_result', team, player, data: { scored: false }, text, display });
      return;
    }
    if (isGoal) {
      const scorer = type === 'own-goal' ? otherShort(team) ?? team : team;
      if (type.startsWith('penalty---scored')) push({ key: `play:${id}:pen`, type: 'penalty_result', team, player, data: { scored: true }, display });
      if (scorer === teams.home.short) score.home += 1;
      else if (scorer === teams.away.short) score.away += 1;
      const data: Record<string, unknown> = {};
      if (type.startsWith('penalty')) data.penalty = true;
      if (type === 'own-goal') data.ownGoal = true;
      push({ key: `play:${id}`, type: 'goal', team: scorer, player, data, text, display });
      return;
    }
    if (type === 'yellow-card' || type === 'red-card' || type === 'yellow-red-card') {
      push({ key: `play:${id}`, type: 'card', team, player, data: { color: type === 'yellow-card' ? 'yellow' : 'red' }, text, display });
      return;
    }
    if (type === 'corner-awarded') {
      push({ key: `play:${id}`, type: 'corner', team, text, display });
      pendingCorner = { id, team, at };
      return;
    }
    if (type === 'substitution') {
      push({ key: `play:${id}`, type: 'sub', team, player, text, display });
      return;
    }

    // Penalty awards only show up as commentary text.
    const awarded = /^Penalty\s+(.+?)\.\s+.*draws a foul in the penalty area/i.exec(row.text);
    const conceded = /^Penalty conceded by .*?\((.+?)\)/i.exec(row.text);
    if (awarded || conceded) {
      const awardedTo = awarded ? shortFor(awarded[1]) : otherShort(shortFor(conceded![1]));
      const drawer = awarded ? /\.\s+(.+?)\s+draws a foul/i.exec(row.text)?.[1] : undefined;
      push({ key: `pen:${period}:${minute}:${awardedTo ?? 'x'}`, type: 'penalty_awarded', team: awardedTo, player: drawer, text, display });
    }
  });

  if (done && events.length > 0) {
    settleCorner(false);
    for (const c of arr(comp.competitors)) {
      const co = obj(c);
      const sc = numMaybe(co.score);
      if (sc === undefined) continue;
      if (co.homeAway === 'home') score.home = sc;
      if (co.homeAway === 'away') score.away = sc;
    }
    if (!endedPeriods.has(period)) push({ key: `period:${period}:end`, type: 'period_end', data: { period } });
    push({ key: 'final', type: 'final' });
  }

  // De-duplicate keys (the two penalty commentary lines share one key).
  const seen = new Set<string>();
  return { teams, events: events.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true))), done };
}

// ───────────────────────── adapter ─────────────────────────

export interface EspnOptions {
  fetch?: FetchLike;
  base?: string;
  soccerLeagues?: string[];
  pollMs?: number;
  timeoutMs?: number;
}

export class EspnAdapter implements SportsAdapter {
  readonly provider = 'espn' as const;
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  private readonly leagues: string[];
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private known = new Map<string, GameInfo>();

  constructor(opts: EspnOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.base = (opts.base ?? ESPN_BASE).replace(/\/$/, '');
    this.leagues = opts.soccerLeagues ?? DEFAULT_SOCCER_LEAGUES;
    this.pollMs = Math.min(10_000, Math.max(5_000, opts.pollMs ?? 7_000));
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  /** `espn:nfl:{id}` or `espn:soccer:{league}:{id}`. */
  static parseId(gameId: string): { sport: Sport; path: string; leaguePath: string; eventId: string } | undefined {
    const parts = gameId.split(':');
    if (parts[0] !== 'espn') return undefined;
    if (parts[1] === 'nfl' && parts[2]) return { sport: 'nfl', path: 'football/nfl', leaguePath: 'nfl', eventId: parts[2] };
    if (parts[1] === 'soccer' && parts[2] && parts[3]) return { sport: 'soccer', path: `soccer/${parts[2]}`, leaguePath: `soccer:${parts[2]}`, eventId: parts[3] };
    return undefined;
  }

  async listGames(sport?: Sport): Promise<GameInfo[]> {
    const jobs: Promise<GameInfo[]>[] = [];
    const board = async (path: string, s: Sport, leaguePath: string): Promise<GameInfo[]> => {
      try {
        return mapEspnScoreboard(await getJson(this.fetchImpl, `${this.base}/${path}/scoreboard`, this.timeoutMs), s, leaguePath);
      } catch {
        return [];
      }
    };
    if (!sport || sport === 'nfl') jobs.push(board('football/nfl', 'nfl', 'nfl'));
    if (!sport || sport === 'soccer') for (const l of this.leagues) jobs.push(board(`soccer/${l}`, 'soccer', `soccer:${l}`));
    const games = (await Promise.all(jobs)).flat();
    for (const g of games) this.known.set(g.id, g);
    return games;
  }

  async getGame(gameId: string): Promise<GameInfo | undefined> {
    if (this.known.has(gameId)) return this.known.get(gameId);
    const parsed = EspnAdapter.parseId(gameId);
    if (!parsed) return undefined;
    await this.listGames(parsed.sport);
    return this.known.get(gameId);
  }

  async open(gameId: string, onEvent: (e: GameEvent) => void): Promise<GameFeed> {
    const parsed = EspnAdapter.parseId(gameId);
    if (!parsed) throw new Error(`not an ESPN game id: ${gameId}`);
    const url = `${this.base}/${parsed.path}/summary?event=${encodeURIComponent(parsed.eventId)}`;
    const map = parsed.sport === 'nfl' ? mapEspnNflSummary : mapEspnSoccerSummary;
    // First fetch up front so a bad id or an outage fails `open` (and the caller can fall back to replay).
    const firstPayload = await getJson(this.fetchImpl, url, this.timeoutMs);
    const first = map(firstPayload);
    let info = this.known.get(gameId);
    if (!info) {
      if (!first.teams) throw new Error(`ESPN summary for ${gameId} has no teams`);
      info = {
        id: gameId,
        sport: parsed.sport,
        title: `${first.teams.home.name} vs ${first.teams.away.name}`,
        home: first.teams.home,
        away: first.teams.away,
        status: first.done ? 'final' : 'live',
        source: 'espn',
      };
      this.known.set(gameId, info);
    }
    let cached: ReturnType<typeof map> | undefined = first;
    return createPollingFeed({
      info,
      sport: parsed.sport,
      intervalMs: this.pollMs,
      onEvent,
      onError: (err) => console.warn(`[sports] ESPN poll failed: ${(err as Error).message}`),
      snapshot: async () => {
        const snap = cached ?? map(await getJson(this.fetchImpl, url, this.timeoutMs));
        cached = undefined;
        return { events: snap.events, done: snap.done };
      },
    });
  }

  reduce(state: GameState, event: GameEvent): GameState {
    return reduce(state, event);
  }
}
