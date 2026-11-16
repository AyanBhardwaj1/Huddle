import type { Sport, TeamRef } from './types';

/** Normalized sports event (PRD section 11). All providers emit this. */
export type GameEventType =
  | 'kickoff'
  | 'goal'
  | 'penalty_awarded'
  | 'penalty_result'
  | 'corner'
  | 'card'
  | 'sub'
  | 'snap'
  | 'play_result'
  | 'drive_start'
  | 'drive_end'
  | 'period_start'
  | 'period_end'
  | 'final'
  | 'score_update';

export interface GameEvent {
  gameId: string;
  sport: Sport;
  seq: number;
  /** Wall clock of the event. */
  ts: string;
  clock: { period: number; display: string };
  type: GameEventType;
  /** Team short code (matches GameInfo.home.short / away.short). */
  team?: string;
  player?: string;
  /**
   * Type-specific payload. Conventions:
   *  - penalty_result: { scored: boolean }
   *  - goal: { minute: number }
   *  - card: { color: 'yellow' | 'red', minute }
   *  - corner: { minute, shotOnTarget?: boolean }
   *  - snap: { down, distance, yardline }      (yardline = yards from the offense's own goal line, 1..99)
   *  - play_result: { down, distance, yardline, playType: 'run'|'pass'|'kick'|'punt', gained, firstDown, touchdown?, turnover? }
   *  - drive_start: { yardline }
   *  - drive_end: { result: 'td' | 'fg' | 'none' }
   *  - period_start / period_end: { period }
   *  - any: { minute } for soccer (elapsed match minute), { secondsRemaining } for NFL
   */
  data: Record<string, unknown>;
  score: { home: number; away: number };
  /** Optional human commentary line for the box ticker. */
  text?: string;
}

/** Running game state, reduced from the event stream by the sports package. */
export interface GameState {
  gameId: string;
  sport: Sport;
  status: 'pre' | 'live' | 'final';
  home: TeamRef;
  away: TeamRef;
  score: { home: number; away: number };
  clock: { period: number; display: string };
  /** Soccer: elapsed match minute. */
  minute?: number;
  /** NFL: seconds remaining in the game. */
  secondsRemaining?: number;
  possession?: 'home' | 'away';
  down?: number;
  distance?: number;
  yardline?: number;
  lastSeq: number;
  /** Free-form counters, e.g. cards_total, cards_home, corners_away, goals_period_2_home. */
  counters: Record<string, number>;
  /** Score at the end of each completed period, for period_winner resolvers. */
  periodScores: { period: number; home: number; away: number }[];
  lastEvent?: GameEvent;
}

export function initialGameState(
  gameId: string,
  sport: Sport,
  home: TeamRef,
  away: TeamRef,
): GameState {
  return {
    gameId,
    sport,
    status: 'pre',
    home,
    away,
    score: { home: 0, away: 0 },
    clock: { period: 0, display: sport === 'soccer' ? "0'" : '15:00' },
    lastSeq: 0,
    counters: {},
    periodScores: [],
  };
}
