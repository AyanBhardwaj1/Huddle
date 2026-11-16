import type { GameEvent, GameFeed, GameInfo, GameState, Sport, SportsAdapter, TeamRef } from '@huddle/shared';
import { arr, createPollingFeed, getJson, numMaybe, numOr, obj, str, type FetchLike, type KeyedEvent } from './live';
import { reduce } from './reduce';

/**
 * API-Football v3 (api-sports.io; PRD section 11, P1). Needs `API_FOOTBALL_KEY`.
 *   live fixtures: GET {base}/fixtures?live=all
 *   one fixture:   GET {base}/fixtures?id={id}   (includes `events`, `goals`, `fixture.status`)
 * The free tier is 100 requests/day, so the default poll interval is 15 s and one call per poll.
 * The provider has no corner events and no "penalty awarded" moment (only VAR "Penalty confirmed").
 */
export const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

const FIRST_HALF_OVER = new Set(['HT', '2H', 'ET', 'BT', 'P', 'FT', 'AET', 'PEN', 'INT']);
const SECOND_HALF_ON = new Set(['2H', 'ET', 'BT', 'P', 'FT', 'AET', 'PEN']);
const FINISHED = new Set(['FT', 'AET', 'PEN']);
const STARTED = new Set(['1H', ...FIRST_HALF_OVER, 'LIVE']);

function shortCode(name: string, taken?: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  let code = letters.slice(0, 3) || 'TBD';
  if (code === taken) code = (letters.slice(0, 2) + (letters.slice(-1) || 'X')).slice(0, 3);
  if (code === taken) code = `${code.slice(0, 2)}2`;
  return code;
}

function fixtureTeams(fx: Record<string, unknown>): { home: TeamRef; away: TeamRef; homeId?: string; awayId?: string } | undefined {
  const teams = obj(fx.teams);
  const h = obj(teams.home);
  const a = obj(teams.away);
  const hn = str(h.name);
  const an = str(a.name);
  if (!hn || !an) return undefined;
  const hs = shortCode(hn);
  return { home: { name: hn, short: hs }, away: { name: an, short: shortCode(an, hs) }, homeId: str(h.id), awayId: str(a.id) };
}

function fixtureInfo(fx: Record<string, unknown>): GameInfo | undefined {
  const teams = fixtureTeams(fx);
  const fixture = obj(fx.fixture);
  const id = str(fixture.id);
  if (!teams || !id) return undefined;
  const short = str(obj(fixture.status).short) ?? 'NS';
  const info: GameInfo = {
    id: `apif:${id}`,
    sport: 'soccer',
    title: `${teams.home.name} vs ${teams.away.name}`,
    home: teams.home,
    away: teams.away,
    status: FINISHED.has(short) ? 'final' : STARTED.has(short) ? 'live' : 'scheduled',
    source: 'apifootball',
  };
  const date = str(fixture.date);
  if (date && !Number.isNaN(Date.parse(date))) info.startsAt = new Date(date).toISOString();
  return info;
}

/** Map a `/fixtures?live=all` (or `?date=`) payload to games. */
export function mapApiFootballFixtures(payload: unknown): GameInfo[] {
  return arr(obj(payload).response)
    .map((f) => fixtureInfo(obj(f)))
    .filter((g): g is GameInfo => g !== undefined);
}

/** Map a `/fixtures?id=` payload to the full ordered event list so far. Pure. */
export function mapApiFootballFixture(payload: unknown): { info?: GameInfo; events: KeyedEvent[]; done: boolean } {
  const fx = obj(arr(obj(payload).response)[0]);
  const info = fixtureInfo(fx);
  const teams = fixtureTeams(fx);
  if (!info || !teams) return { events: [], done: false };
  const status = str(obj(obj(fx.fixture).status).short) ?? 'NS';
  const elapsedNow = numOr(obj(obj(fx.fixture).status).elapsed, 0);
  const done = FINISHED.has(status);

  const events: KeyedEvent[] = [];
  const score = { home: 0, away: 0 };
  let period = 1;
  const push = (key: string, type: KeyedEvent['type'], minute: number, extra: Partial<KeyedEvent> = {}, display?: string): void => {
    events.push({ key, type, clock: { period, display: display ?? `${minute}'` }, score: { ...score }, ...extra, data: { minute, ...(extra.data ?? {}) } });
  };
  const teamShort = (t: Record<string, unknown>): string | undefined => {
    const id = str(t.id);
    if (id && id === teams.homeId) return teams.home.short;
    if (id && id === teams.awayId) return teams.away.short;
    const name = str(t.name);
    if (name === teams.home.name) return teams.home.short;
    if (name === teams.away.name) return teams.away.short;
    return undefined;
  };
  const other = (short: string | undefined): string | undefined =>
    short === teams.home.short ? teams.away.short : short === teams.away.short ? teams.home.short : undefined;

  if (!STARTED.has(status) && !done) return { info, events, done };
  push('kickoff', 'kickoff', 0);

  const raw = arr(fx.events)
    .map(obj)
    .map((e, i) => ({ e, i, elapsed: numOr(obj(e.time).elapsed, 0), extra: numOr(obj(e.time).extra, 0) }))
    .sort((a, b) => a.elapsed - b.elapsed || a.extra - b.extra || a.i - b.i);

  const mapOne = ({ e, elapsed, extra }: (typeof raw)[number]): void => {
    const type = (str(e.type) ?? '').toLowerCase();
    const detail = (str(e.detail) ?? '').toLowerCase();
    const team = teamShort(obj(e.team));
    const player = str(obj(e.player).name);
    const display = extra > 0 ? `${elapsed}'+${extra}'` : `${elapsed}'`;
    const key = `${type}:${detail}:${elapsed}:${extra}:${str(obj(e.team).id) ?? '?'}:${str(obj(e.player).id) ?? player ?? '?'}`;
    const comments = str(e.comments);
    if (type === 'goal') {
      if (detail.includes('missed penalty')) {
        push(`${key}:pen`, 'penalty_result', elapsed, { team, player, data: { scored: false }, text: comments }, display);
        return;
      }
      const own = detail.includes('own goal');
      const scorer = own ? other(team) ?? team : team;
      const penalty = detail === 'penalty';
      if (penalty) push(`${key}:pen`, 'penalty_result', elapsed, { team, player, data: { scored: true } }, display);
      if (scorer === teams.home.short) score.home += 1;
      else if (scorer === teams.away.short) score.away += 1;
      const data: Record<string, unknown> = {};
      if (penalty) data.penalty = true;
      if (own) data.ownGoal = true;
      push(key, 'goal', elapsed, { team: scorer, player, data, text: comments }, display);
    } else if (type === 'card') {
      push(key, 'card', elapsed, { team, player, data: { color: detail.includes('yellow card') && !detail.includes('second') ? 'yellow' : 'red' }, text: comments }, display);
    } else if (type === 'subst') {
      push(key, 'sub', elapsed, { team, player: str(obj(e.assist).name) ?? player, text: comments }, display);
    } else if (type === 'var' && detail.includes('penalty confirmed')) {
      push(key, 'penalty_awarded', elapsed, { team, player, text: comments }, display);
    }
  };

  for (const r of raw.filter((x) => x.elapsed <= 45)) mapOne(r);
  if (FIRST_HALF_OVER.has(status)) {
    push('period:1:end', 'period_end', 45, { data: { period: 1 } });
    if (SECOND_HALF_ON.has(status)) {
      period = 2;
      push('period:2:start', 'period_start', 45, { data: { period: 2 } });
      for (const r of raw.filter((x) => x.elapsed > 45)) mapOne(r);
    }
  }
  if (done) {
    const goals = obj(fx.goals);
    score.home = numMaybe(goals.home) ?? score.home;
    score.away = numMaybe(goals.away) ?? score.away;
    const minute = Math.max(90, elapsedNow);
    push(`period:${period}:end`, 'period_end', minute, { data: { period } });
    push('final', 'final', minute);
  }
  return { info, events, done };
}

export interface ApiFootballOptions {
  apiKey: string;
  fetch?: FetchLike;
  base?: string;
  pollMs?: number;
  timeoutMs?: number;
}

export class ApiFootballAdapter implements SportsAdapter {
  readonly provider = 'apifootball' as const;
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private known = new Map<string, GameInfo>();

  constructor(opts: ApiFootballOptions) {
    if (!opts.apiKey) throw new Error('API_FOOTBALL_KEY is not set');
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.base = (opts.base ?? API_FOOTBALL_BASE).replace(/\/$/, '');
    this.headers = { 'x-apisports-key': opts.apiKey };
    this.pollMs = Math.max(5_000, opts.pollMs ?? 15_000);
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async listGames(sport?: Sport): Promise<GameInfo[]> {
    if (sport && sport !== 'soccer') return [];
    try {
      const games = mapApiFootballFixtures(await getJson(this.fetchImpl, `${this.base}/fixtures?live=all`, this.timeoutMs, this.headers));
      for (const g of games) this.known.set(g.id, g);
      return games;
    } catch {
      return [];
    }
  }

  private async fixture(gameId: string): Promise<ReturnType<typeof mapApiFootballFixture>> {
    const id = gameId.startsWith('apif:') ? gameId.slice(5) : '';
    if (!/^\d+$/.test(id)) throw new Error(`not an API-Football game id: ${gameId}`);
    return mapApiFootballFixture(await getJson(this.fetchImpl, `${this.base}/fixtures?id=${id}`, this.timeoutMs, this.headers));
  }

  async getGame(gameId: string): Promise<GameInfo | undefined> {
    if (this.known.has(gameId)) return this.known.get(gameId);
    try {
      const { info } = await this.fixture(gameId);
      if (info) this.known.set(gameId, info);
      return info;
    } catch {
      return undefined;
    }
  }

  async open(gameId: string, onEvent: (e: GameEvent) => void): Promise<GameFeed> {
    const first = await this.fixture(gameId);
    if (!first.info) throw new Error(`API-Football has no fixture ${gameId}`);
    this.known.set(gameId, first.info);
    let cached: typeof first | undefined = first;
    return createPollingFeed({
      info: first.info,
      sport: 'soccer',
      intervalMs: this.pollMs,
      onEvent,
      onError: (err) => console.warn(`[sports] API-Football poll failed: ${(err as Error).message}`),
      snapshot: async () => {
        const snap = cached ?? (await this.fixture(gameId));
        cached = undefined;
        return { events: snap.events, done: snap.done };
      },
    });
  }

  reduce(state: GameState, event: GameEvent): GameState {
    return reduce(state, event);
  }
}
