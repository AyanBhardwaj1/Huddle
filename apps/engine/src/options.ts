import type {
  Announcer,
  BoxBridge,
  GeminiClient,
  LlmClient,
  PartyConfig,
  QuestionEngine,
  QuestionRanker,
  SettlementClient,
  SettlementMode,
  SportsAdapter,
} from '@huddle/shared';
import type { Logger } from 'pino';
import type { CoreTiming } from './core/party-core';

export type Env = Record<string, string | undefined>;

/** Every external dependency of the engine. Tests pass mocks from `@huddle/shared/mocks`. */
export interface EngineAdapters {
  sports: SportsAdapter;
  /** One question engine per party (the real one keeps per-game calibration). */
  questionEngine: () => QuestionEngine;
  ranker: QuestionRanker;
  gemini: GeminiClient;
  llm: LlmClient;
  announcer: Announcer;
  /** One settlement client per mode, created on first use and cached. */
  settlement: (mode: SettlementMode) => SettlementClient;
  /** Null = no box bridge (LED commands are still mirrored to box-role WebSocket clients). */
  bridge: BoxBridge | null;
}

export interface EngineTiming {
  /**
   * Divides every game-time duration the engine controls (lock countdowns, dispute and challenge
   * windows, rate limits, co-sign grace, draft TTL). 1 in production; tests replay at high speed
   * with a matching scale.
   */
  timeScale: number;
  /** Real ms between engine ticks (countdown locks, dispute windows, draft expiry). */
  tickMs: number;
  /** At close, how long to wait for connected phones to countersign their final state. */
  cosignWaitMs: number;
  /** At close, how long to wait for the host to settle a disputed market before voiding it. */
  disputeDecisionMs: number;
  /** How long a transient LED pattern shows before returning to idle. */
  ledResetMs: number;
  /** Real ms guard around the question ranker (it has its own 1.5 s fallback). */
  rankTimeoutMs: number;
  /** Real ms between Gemini quote refreshes; 0 disables the timer. */
  geminiRefreshMs: number;
  /** Real ms a wallet must wait between faucet drips. */
  faucetCooldownMs: number;
  /** Real ms guard around slow party-creation steps (Gemini match). */
  setupTimeoutMs: number;
  core: Partial<CoreTiming>;
}

export const DEFAULT_TIMING: EngineTiming = {
  timeScale: 1,
  tickMs: 100,
  cosignWaitMs: 5_000,
  disputeDecisionMs: 60_000,
  ledResetMs: 4_000,
  rankTimeoutMs: 2_000,
  geminiRefreshMs: 30_000,
  faucetCooldownMs: 10 * 60_000,
  setupTimeoutMs: 5_000,
  core: {},
};

export interface EngineOptions {
  /** Default: env PORT, else 8080. Use 0 for a random free port (tests). */
  port?: number;
  host?: string;
  /** Default: process.env. */
  env?: Env;
  /** Where SQLite and the key files live. Default: env DATA_DIR, else ./data. ":memory:" keeps nothing on disk. */
  dataDir?: string;
  adapters?: Partial<EngineAdapters>;
  timing?: Partial<EngineTiming>;
  /** Overrides for the default party config (tests shorten the dispute and challenge windows). */
  partyDefaults?: Partial<PartyConfig>;
  /** Clock, ms epoch. Default: Date.now. */
  now?: () => number;
  /** A pino logger, or false to silence. */
  logger?: Logger | false;
  /** Folders with the built UIs. Default: apps/box/dist and apps/player/dist. */
  staticDirs?: { box?: string; player?: string };
}

export const ENGINE_VERSION = '0.1.0';
export const FAUCET_AMOUNT = 25_000_000;
