import type { GameEvent, GameFeed, GameInfo, GameState, Sport, SportsAdapter } from '@huddle/shared';
import { ApiFootballAdapter } from './apifootball';
import { EspnAdapter } from './espn';
import { reduce } from './reduce';
import { ReplayAdapter, resolveReplayDir } from './replay';

export type Env = Record<string, string | undefined>;

/**
 * A live provider plus the replays: lists both (replays first, so the demo game is always there),
 * routes `open` by game id, and never lets a live outage hide the replay games.
 */
export class CompositeSportsAdapter implements SportsAdapter {
  readonly provider: SportsAdapter['provider'];

  constructor(
    private readonly live: SportsAdapter,
    private readonly replay: SportsAdapter,
  ) {
    this.provider = live.provider;
  }

  async listGames(sport?: Sport): Promise<GameInfo[]> {
    const replays = await this.replay.listGames(sport);
    try {
      return [...replays, ...(await this.live.listGames(sport))];
    } catch (err) {
      console.warn(`[sports] ${this.live.provider} listGames failed, showing replays only: ${(err as Error).message}`);
      return replays;
    }
  }

  async getGame(gameId: string): Promise<GameInfo | undefined> {
    const replay = await this.replay.getGame(gameId);
    if (replay) return replay;
    try {
      return await this.live.getGame(gameId);
    } catch {
      return undefined;
    }
  }

  async open(gameId: string, onEvent: (e: GameEvent) => void): Promise<GameFeed> {
    if (await this.replay.getGame(gameId)) return this.replay.open(gameId, onEvent);
    return this.live.open(gameId, onEvent);
  }

  reduce(state: GameState, event: GameEvent): GameState {
    return reduce(state, event);
  }
}

/**
 * Sports data adapter factory (PRD section 11). `SPORTS_PROVIDER` = `replay` (default) | `espn` |
 * `apifootball`. Live providers are wrapped so replay games are always listed too, and any failure
 * to set one up falls back to plain replay. Never throws.
 *
 * Env: SPORTS_PROVIDER, REPLAY_DIR, API_FOOTBALL_KEY, ESPN_SOCCER_LEAGUES (comma list),
 * SPORTS_POLL_MS.
 */
export function createSportsAdapter(env: Env = process.env): SportsAdapter {
  const replay = new ReplayAdapter(resolveReplayDir(env));
  const provider = (env.SPORTS_PROVIDER ?? 'replay').trim().toLowerCase();
  const pollMs = env.SPORTS_POLL_MS ? Number(env.SPORTS_POLL_MS) : undefined;
  try {
    if (provider === 'espn') {
      const leagues = env.ESPN_SOCCER_LEAGUES?.split(',').map((s) => s.trim()).filter(Boolean);
      return new CompositeSportsAdapter(new EspnAdapter({ soccerLeagues: leagues?.length ? leagues : undefined, pollMs: Number.isFinite(pollMs) ? pollMs : undefined }), replay);
    }
    if (provider === 'apifootball') {
      if (!env.API_FOOTBALL_KEY) {
        console.warn('[sports] SPORTS_PROVIDER=apifootball but API_FOOTBALL_KEY is not set; using replay');
        return replay;
      }
      return new CompositeSportsAdapter(new ApiFootballAdapter({ apiKey: env.API_FOOTBALL_KEY, pollMs: Number.isFinite(pollMs) ? pollMs : undefined }), replay);
    }
    if (provider !== 'replay' && provider !== '') console.warn(`[sports] unknown SPORTS_PROVIDER "${provider}"; using replay`);
  } catch (err) {
    console.warn(`[sports] ${provider} adapter failed to start, using replay: ${(err as Error).message}`);
  }
  return replay;
}

export { reduce, sideOf, nflSecondsRemaining } from './reduce';
export {
  ReplayAdapter,
  buildTimeline,
  createReplayFeed,
  loadTimelines,
  resolveReplayDir,
  MIN_SPEED,
  MAX_SPEED,
  type ReplayClock,
  type ReplayEntry,
  type ReplayFile,
  type Timeline,
} from './replay';
export { EspnAdapter, mapEspnScoreboard, mapEspnNflSummary, mapEspnSoccerSummary } from './espn';
export { ApiFootballAdapter, mapApiFootballFixture, mapApiFootballFixtures } from './apifootball';
export { createPollingFeed, type KeyedEvent, type FetchLike } from './live';
