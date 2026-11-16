import type { AnnouncerEvent, AnnouncerLine, RoomContext, TalkContext, TalkReply } from './announcer';
import type { BridgeCommand, BridgeEvent } from './bridge';
import type { GameEvent, GameState } from './events';
import type {
  ChainEvent,
  GameInfo,
  GeminiEventQuote,
  GeminiPanel,
  GeminiRef,
  Market,
  MarketResolver,
  Outcome,
  Persona,
  ReplayStatus,
  SettlementMode,
  Sport,
} from './types';

/**
 * Adapter interfaces (PRD sections 9 + 11). Every external service sits behind one of these with a
 * mock in `@huddle/shared/mocks`. Each workspace package exports a factory with the name noted below;
 * the engine only ever imports those factories.
 */

// ───────────────────────── Settlement (@huddle/solana-client: createSettlementClient) ─────────────────────────

export interface SignedClaim {
  member: string;
  nonce: number;
  balance: number;
  stateHash: string;
  boxSig: string;
  memberSig?: string;
}

export interface DepositRequest {
  depositId: string;
  /**
   * Base64 transaction *message* bytes for the member to sign with their wallet key (the treasury is
   * the fee payer, so players never need SOL). Null in points mode: nothing to sign.
   */
  messageB64: string | null;
}

export interface CreatePartyParams {
  partyId: string;
  /**
   * The host (house) key is held by the engine (DECISIONS D4): it signs create_party and pays the bond.
   * On devnet the client first tops this wallet up from the treasury so it can cover the bond.
   */
  hostSecretKey: Uint8Array;
  /** Box signer public key, base58. */
  boxSigner: string;
  bond: number;
  challengeSecs: number;
  requireMemberSig: boolean;
}

/** ElevenLabs Agents session for the TALK button (P1). */
export interface AgentSession {
  agentId: string;
  /** Signed conversation URL when the agent is private. */
  signedUrl?: string;
  /** Passed to the agent as dynamic variables (party code, player name, session token). */
  dynamicVariables: Record<string, string>;
}

export interface SettlementClient {
  readonly mode: SettlementMode;
  /** Human-readable description for the host screen ("Solana devnet", "points only", "mock vault"). */
  readonly label: string;

  /** Create the party on-chain and deposit the host bond. Returns the party address (PDA). */
  createParty(params: CreatePartyParams): Promise<{ partyAddress: string; txSig?: string }>;

  /** Step 1 of a buy-in: build the deposit for the member to sign. */
  prepareDeposit(params: { partyAddress: string; member: string; amount: number }): Promise<DepositRequest>;
  /** Step 2: attach the member signature and submit. Resolves when the deposit is confirmed. */
  submitDeposit(params: { depositId: string; memberSignatureB64?: string }): Promise<{ txSig?: string; amount: number }>;

  /** Deposit from an engine-held key (the host's house budget). */
  depositFromKey(params: { partyAddress: string; secretKey: Uint8Array; amount: number }): Promise<{ txSig?: string }>;

  /** Signed by the host key or the box signer key. */
  requestClose(partyAddress: string, signerSecretKey: Uint8Array): Promise<{ txSig?: string; challengeEndsAt: string }>;
  submitState(partyAddress: string, claim: SignedClaim): Promise<{ txSig?: string }>;
  /** After the challenge window. Returns each member's final payout in base units. */
  finalize(partyAddress: string): Promise<{ txSig?: string; payouts: Record<string, number>; hostRefund: number }>;
  /** Crank a member's withdrawal to their wallet. */
  withdraw(partyAddress: string, member: string): Promise<{ txSig?: string; amount: number }>;

  /** Devnet faucet: send test USDC to a new player (rate-limited per wallet by the engine). */
  faucet(wallet: string, amount: number): Promise<{ txSig?: string }>;
  /** Wallet USDC balance in base units (0 in points mode). */
  walletBalance(wallet: string): Promise<number>;

  /** Program events via RPC log subscription (fallback when QuickNode Streams is not configured). */
  subscribe(onEvent: (e: ChainEvent) => void): () => void;
  explorerUrl(txSig: string): string | undefined;
}

// ───────────────────────── Sports data (@huddle/sports: createSportsAdapter) ─────────────────────────

export interface ReplayControl {
  start(): void;
  pause(): void;
  seek(positionMs: number): void;
  setSpeed(speed: number): void;
  status(): ReplayStatus;
}

export interface GameFeed {
  info: GameInfo;
  /** Present for replay games. Live feeds start immediately. */
  control?: ReplayControl;
  stop(): void;
}

export interface SportsAdapter {
  readonly provider: 'replay' | 'espn' | 'apifootball' | 'mock';
  listGames(sport?: Sport): Promise<GameInfo[]>;
  getGame(gameId: string): Promise<GameInfo | undefined>;
  /** Open a feed. Replay feeds are created paused; call `control.start()`. Events arrive in seq order. */
  open(gameId: string, onEvent: (e: GameEvent) => void): Promise<GameFeed>;
  /** Pure reducer: fold one event into the running game state. */
  reduce(state: GameState, event: GameEvent): GameState;
}

// ───────────────────────── Questions + pricing (@huddle/models: createQuestionEngine) ─────────────────────────

export interface MarketCandidate {
  templateId: string;
  kind: 'moment' | 'game';
  /** Default template text, used when the LLM is unavailable. */
  question: string;
  /** Default one-line announcer hook. */
  hook: string;
  outcomes: Outcome[];
  /** Model probabilities, sum to 1. The LLM never changes these. */
  prior: Record<string, number>;
  /** Countdown lock in seconds from open (moment markets). */
  lockAfterSecs?: number;
  /** Event-based lock, see MarketLock.onEvent. */
  lockOnEvent?: string;
  resolver: MarketResolver;
  /** Hint for matching a Gemini contract. */
  geminiHint?: { kind: 'moneyline' | 'period_winner' | 'total'; period?: string; team?: string; line?: number };
  /** Higher = more interesting; the ranker keeps the best 1 to 2. */
  priority: number;
  /** Short explanation of the price for `explain_odds` ("League penalty conversion is 76%..."). */
  rationale?: string;
}

export type ResolverResult = { outcome: string } | { void: true; reason: string } | null;

export interface QuestionEngine {
  /** Trigger rules: candidate questions for this event, already priced. Deterministic. */
  propose(event: GameEvent, state: GameState, open: Market[]): MarketCandidate[];
  /** Does this event lock the market (its `lock.onEvent`)? */
  shouldLock(market: Market, event: GameEvent, state: GameState): boolean;
  /** Run the market's resolver against a new event. Null = not decided yet. */
  evaluate(market: Market, event: GameEvent, state: GameState): ResolverResult;
  /** Live model probability for a market given the current state (game-long markets), if the model can. */
  reprice(market: Market, state: GameState): Record<string, number> | null;
  /** Plain-language explanation of a market's price and the model behind it. */
  explain(market: Market, state: GameState): string;
  /** Optional Gemini calibration hook (P1): feed matched quotes to adjust team strength. */
  calibrate?(game: GameInfo, quotes: GeminiEventQuote[]): void;
}

export interface RankedPick {
  /** Index into the candidates array. */
  index: number;
  question: string;
  hook: string;
}

export interface QuestionRanker {
  /** Pick the best 1 to 2 candidates and phrase them. Must fall back to template text within 1.5 s. */
  rank(candidates: MarketCandidate[], ctx: RoomContext, maxPicks: number): Promise<RankedPick[]>;
}

// ───────────────────────── Gemini Prediction Markets (@huddle/gemini: createGeminiClient) ─────────────────────────

export interface GeminiClient {
  readonly source: 'live' | 'mock';
  /** Search Gemini for the game by team names and date; returns the matched events with quotes. */
  matchGame(game: GameInfo): Promise<GeminiPanel>;
  /** Refresh quotes for previously matched events. */
  refresh(panel: GeminiPanel): Promise<GeminiPanel>;
  /** Map a candidate/market to a matched Gemini contract, if comparable. */
  refFor(
    panel: GeminiPanel,
    hint: MarketCandidate['geminiHint'],
    outcomes: Outcome[],
    game: GameInfo,
  ): GeminiRef | undefined;
}

// ───────────────────────── LLM (@huddle/announcer: createLlmClient) ─────────────────────────

export interface LlmClient {
  readonly available: boolean;
  /**
   * One JSON completion. Resolves null on timeout, API error or invalid JSON, so callers always fall
   * back to templates. Never throws.
   */
  completeJson(req: { system: string; user: string; maxTokens?: number; timeoutMs?: number }): Promise<unknown | null>;
}

// ───────────────────────── Announcer (@huddle/announcer: createAnnouncer) ─────────────────────────

export interface Announcer {
  readonly provider: 'elevenlabs' | 'webspeech' | 'mock';
  /** Pre-generate and cache the common lines for a persona at party start. */
  warmup(persona: Persona): Promise<void>;
  /** Turn an event into one spoken line (text + optional audio). Null = nothing worth saying. */
  announce(event: AnnouncerEvent, ctx: RoomContext): Promise<AnnouncerLine | null>;
  /** Audio bytes for `line.audioUrl` = `/audio/:id`. */
  getAudio(id: string): { mime: string; data: Uint8Array } | undefined;
  /** TALK fallback without an ElevenLabs agent: answer a typed/transcribed question. */
  answer(text: string, ctx: TalkContext): Promise<TalkReply>;
  /**
   * Start an ElevenLabs Agents conversation (P1). Null when no agent is configured, in which case
   * clients fall back to Web Speech recognition + `talk_text`.
   */
  agentSession?(params: { partyCode: string; playerName?: string; sessionToken: string }): Promise<AgentSession | null>;
}

// ───────────────────────── Box bridge (apps/box-bridge; client in @huddle/shared) ─────────────────────────

export interface BoxBridge {
  readonly connected: boolean;
  send(cmd: BridgeCommand): void;
  onEvent(cb: (e: BridgeEvent) => void): () => void;
  close(): void;
}
