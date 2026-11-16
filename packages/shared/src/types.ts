/**
 * Core domain types (PRD section 5, 6, 8, 11).
 *
 * Conventions used everywhere:
 *  - Money is an integer number of USDC base units (6 decimals). 1 USDC = 1_000_000. Never floats.
 *  - Public keys are base58 strings. Signatures are base64 strings. Hashes are lowercase hex.
 *  - Timestamps are ISO-8601 strings.
 *  - Probabilities are floats in [0, 1]; a `Record<outcomeId, number>` of them sums to 1.
 */

export type Sport = 'soccer' | 'nfl';
export type MarketMode = 'bet' | 'pool' | 'amm';
export type MarketState =
  | 'draft'
  | 'open'
  | 'locked'
  | 'resolved'
  | 'disputed'
  | 'final'
  | 'voided'
  | 'discarded';
export type SettlementMode = 'vault' | 'trusted' | 'points';
export type Persona = 'soccer' | 'nfl' | 'calm';
export type PartyStatus = 'lobby' | 'live' | 'ended' | 'closing' | 'finalized';

export interface Outcome {
  id: string;
  label: string;
}

export interface GeminiRef {
  eventTicker: string;
  contractTicker: string;
  /** Gemini mid price for the outcome named by `outcomeId` (0..1). */
  prob: number;
  asOf: string;
  /** Which of our outcomes the Gemini contract corresponds to (default: first outcome). */
  outcomeId?: string;
  label?: string;
  url?: string;
}

export interface MarketLock {
  /** Wall-clock lock time (countdown). */
  at?: string;
  /**
   * Lock when a matching game event fires. Format: an event type (`"penalty_result"`, `"snap"`, `"goal"`),
   * optionally qualified: `"period_end:2"`, `"minute:80"`. Interpreted by `QuestionEngine.shouldLock`.
   */
  onEvent?: string;
  manual: true;
}

export interface MarketResolver {
  type: string;
  params: Record<string, unknown>;
}

export interface Market {
  id: string;
  partyId: string;
  question: string;
  kind: 'moment' | 'game';
  mode: MarketMode;
  outcomes: Outcome[];
  /** Model probabilities at creation, sum to 1. */
  prior: Record<string, number>;
  geminiRef?: GeminiRef;
  /** LMSR liquidity in USDC units, amm mode only. */
  ammB?: number;
  /** Outstanding LMSR shares per outcome (decimal strings), amm mode only. */
  q?: Record<string, string>;
  /** Pool stakes per outcome in base units, pool mode only. */
  pool?: Record<string, number>;
  lock: MarketLock;
  resolver: MarketResolver;
  state: MarketState;
  outcome?: string;
  createdBy: 'ai' | 'host' | 'player';

  // ---- Fields beyond the PRD's minimal type (all engine-maintained) ----
  /** Current room probability per outcome: AMM price, pool share, or bet-implied. Falls back to prior. */
  price: Record<string, number>;
  /** Room probability frozen at lock (for the scorecard). */
  roomProbAtLock?: Record<string, number>;
  /** Total base units staked or traded. */
  volume: number;
  /** One-line announcer hook written with the question. */
  hook?: string;
  templateId?: string;
  /** Game event seq at creation, so resolvers ignore older events. */
  createdAtSeq?: number;
  createdAt: string;
  openedAt?: string;
  lockedAt?: string;
  resolvedAt?: string;
  /** End of the dispute window while `resolved`. */
  disputeEndsAt?: string;
  dispute?: { by: string; reason: string; at: string };
  voidReason?: string;
}

export interface Position {
  partyId: string;
  marketId: string;
  player: string;
  outcome: string;
  /** AMM shares held (decimal string, 6 dp). */
  shares?: string;
  /** Base units at risk (net cost for AMM, stake for pool/bet). */
  stake: number;
  /** Base units returned if this outcome wins (bet + amm; pool is an estimate at current pool). */
  potential?: number;
}

export interface BetOffer {
  id: string;
  marketId: string;
  maker: string;
  /** Outcome the maker backs. Takers win if any other outcome wins. */
  side: string;
  /** Maker stake in base units. */
  makerStake: number;
  /** Decimal odds the maker gets on their stake (e.g. 1.30), 2 dp, >= 1.01. */
  odds: number;
  /** Maker stake already matched, base units. */
  filled: number;
  open: boolean;
  makerName?: string;
  createdAt: string;
}

export interface PartyConfig {
  defaultMode: MarketMode;
  /** Default buy-in, base units. */
  buyIn: number;
  /** Host-set maximum total buy-in per player, base units. */
  maxBuyIn: number;
  /** House budget L per AMM market, base units (worst-case market-maker loss). */
  houseBudgetPerMarket: number;
  /** Total house budget the host puts up for the party, base units. */
  houseBudget: number;
  /** Minimum stake, base units (default 100_000 = 0.10 USDC). */
  minStake: number;
  /** Max stake per player per market as a fraction of their balance (default 0.5). */
  maxStakeFraction: number;
  /** Auto-open AI drafts (true) or hold them for host approval (false). */
  autoApprove: boolean;
  momentLockSecs: number;
  disputeSecs: number;
  challengeSecs: number;
  persona: Persona;
  settlement: SettlementMode;
  requireMemberSig: boolean;
  /** Host bond, base units. */
  bond: number;
}

export interface TeamRef {
  name: string;
  /** Short code, e.g. "POR". GameEvent.team uses this code. */
  short: string;
  color?: string;
}

export interface GameInfo {
  id: string;
  sport: Sport;
  title: string;
  home: TeamRef;
  away: TeamRef;
  startsAt?: string;
  status: 'replay' | 'scheduled' | 'live' | 'final';
  source: 'replay' | 'espn' | 'apifootball' | 'mock';
  /** Optional video file/URL synced to the replay timeline. */
  videoUrl?: string;
  /** Replay length in ms at 1x. */
  durationMs?: number;
}

export interface PartyChainInfo {
  /** Party PDA (vault modes) or a random 32-byte id (points mode), base58. */
  partyAddress: string;
  createTx?: string;
  closeTx?: string;
  finalizeTx?: string;
  challengeEndsAt?: string;
  explorerBase?: string;
}

export interface Party {
  id: string;
  /** Short join code, e.g. "ABCD". */
  code: string;
  name: string;
  hostPubkey: string;
  boxSigner: string;
  game: GameInfo;
  config: PartyConfig;
  status: PartyStatus;
  createdAt: string;
  chain: PartyChainInfo;
  joinUrl: string;
}

export interface PlayerPublic {
  pubkey: string;
  name: string;
  /** The host's house account that funds the market maker. */
  isHouse: boolean;
  remote: boolean;
  connected: boolean;
  /** Total bought in, base units. */
  deposited: number;
  /** Available cash, base units (this is what gets signed). */
  balance: number;
  /** Base units locked in open positions and unmatched offers, at cost. */
  locked: number;
  /** balance + locked - deposited. */
  pnl: number;
  joinedAt: string;
  /** Final on-chain payout once the party is finalized. */
  payout?: number;
  withdrawTx?: string;
  /** Current winning/losing streak (+n wins, -n losses). */
  streak?: number;
}

export type FillKind =
  | 'pool_bet'
  | 'amm_buy'
  | 'amm_sell'
  | 'offer_posted'
  | 'offer_taken'
  | 'offer_cancelled'
  | 'payout'
  | 'refund';

/** Public trade-feed item. */
export interface Fill {
  id: string;
  marketId: string;
  player: string;
  playerName: string;
  kind: FillKind;
  outcome: string;
  /** Base units moved (always positive). */
  amount: number;
  shares?: string;
  /** Probability/price after the fill for that outcome. */
  price?: number;
  at: string;
}

export type LedgerEntryType =
  | 'deposit'
  | 'stake'
  | 'trade_buy'
  | 'trade_sell'
  | 'offer_lock'
  | 'offer_release'
  | 'payout'
  | 'refund'
  | 'house_escrow'
  | 'house_return'
  | 'adjust';

/** One change to a member's available balance. `amount` is signed base units. */
export interface LedgerEntry {
  seq: number;
  type: LedgerEntryType;
  marketId?: string;
  amount: number;
  memo?: string;
}

/** A signed balance (PRD section 8). */
export interface BalanceState {
  member: string;
  nonce: number;
  /** Available balance after `entries`, base units. */
  balance: number;
  prevBalance: number;
  /** Hex sha256, see `hashLedger`. */
  stateHash: string;
  prevStateHash: string;
  /** Ledger entries since the previous state. */
  entries: LedgerEntry[];
  /** Base64 ed25519 signature by the box signer over `encodeStateMessage`. */
  boxSig: string;
  /** Base64 ed25519 signature by the member, once countersigned. */
  memberSig?: string;
}

/** A voice-created bet that the player must confirm with one tap (PRD section 7). */
export interface DraftBet {
  id: string;
  player: string;
  marketId: string;
  outcome: string;
  amount: number;
  source: 'voice' | 'host';
  createdAt: string;
  expiresAt: string;
}

export interface ScorecardEntry {
  marketId: string;
  question: string;
  outcome: string;
  /** Probability each forecaster gave to the outcome that happened. */
  room: number;
  model: number;
  gemini?: number;
}

export interface Scorecard {
  entries: ScorecardEntry[];
  n: number;
  nGemini: number;
  brier: {
    room: number | null;
    model: number | null;
    /** On the subset of markets with a Gemini price. */
    gemini: number | null;
    roomOnGeminiSubset: number | null;
    modelOnGeminiSubset: number | null;
  };
  /** e.g. "The room beat the model by 0.04 tonight; Gemini still wins". */
  verdict: string;
}

export interface GeminiContractQuote {
  eventTicker: string;
  contractTicker: string;
  label: string;
  /** Mid (or last trade) in 0..1; null when unavailable (never show a misleading number). */
  prob: number | null;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  source: 'mid' | 'last' | 'unavailable';
  asOf: string;
  url?: string;
}

export interface GeminiEventQuote {
  eventTicker: string;
  title: string;
  /** What kind of market this is, for matching to our templates. */
  kind: 'moneyline' | 'period_winner' | 'total' | 'spread' | 'other';
  period?: string;
  contracts: GeminiContractQuote[];
  url?: string;
}

/** "Friends vs. the Pros" panel state. */
export interface GeminiPanel {
  available: boolean;
  /** Why the column is hidden, shown on the host screen. */
  note?: string;
  source: 'live' | 'mock' | 'none';
  events: GeminiEventQuote[];
  asOf?: string;
}

export interface ReplayStatus {
  gameId: string;
  playing: boolean;
  speed: number;
  positionMs: number;
  durationMs: number;
  seq: number;
  totalEvents: number;
}

export type ChainEventKind = 'create_party' | 'deposit' | 'request_close' | 'submit_state' | 'finalize' | 'withdraw';

/** Normalized on-chain event from QuickNode Streams or the RPC log fallback. */
export interface ChainEvent {
  kind: ChainEventKind;
  signature: string;
  slot?: number;
  blockTime?: number;
  partyAddress: string;
  member?: string;
  amount?: number;
  via: 'quicknode' | 'rpc' | 'direct' | 'mock';
  explorerUrl?: string;
}

export const USDC_DECIMALS = 6;
export const USDC = 1_000_000;

export const DEFAULT_PARTY_CONFIG: PartyConfig = {
  defaultMode: 'pool',
  buyIn: 10 * USDC,
  maxBuyIn: 50 * USDC,
  houseBudgetPerMarket: 6 * USDC,
  houseBudget: 50 * USDC,
  minStake: USDC / 10,
  maxStakeFraction: 0.5,
  autoApprove: true,
  momentLockSecs: 20,
  disputeSecs: 20,
  challengeSecs: 60,
  persona: 'soccer',
  settlement: 'points',
  requireMemberSig: true,
  bond: 5 * USDC,
};
