import { z } from 'zod';
import type { AnnouncerLine } from './announcer';
import type { LedPattern } from './bridge';
import type { GameEvent, GameState } from './events';
import type {
  BalanceState,
  BetOffer,
  ChainEvent,
  DraftBet,
  Fill,
  GeminiPanel,
  Market,
  Party,
  PlayerPublic,
  Position,
  ReplayStatus,
  Scorecard,
} from './types';

/**
 * WebSocket protocol (`/ws`, JSON, PRD section 9).
 *
 * Handshake:
 *   engine -> `hello {challenge}`
 *   client -> `join {partyCode, role, playerPubkey, name, signature}` where signature =
 *             ed25519(joinChallengeMessage(challenge, partyCode)) by the player's wallet key.
 *             The box UI joins with role "box" and the `hostToken` returned by POST /parties.
 *   engine -> `ack`, then `party_state` (full snapshot).
 *
 * Every client message carries a client-generated `id`; the engine answers with `ack {id, ok, error?, data?}`.
 */

const id = z.string().min(1).max(64);
const pubkey = z.string().min(32).max(44);
const marketId = z.string().min(1).max(64);
const outcomeId = z.string().min(1).max(64);
const amount = z.number().int().positive().max(1_000_000_000_000);
const sharesStr = z.string().regex(/^\d+(\.\d{1,6})?$/);
const modeSchema = z.enum(['bet', 'pool', 'amm']);
export const personaSchema = z.enum(['soccer', 'nfl', 'calm']);
export const settlementSchema = z.enum(['vault', 'trusted', 'points']);

export const hostActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('lock'), marketId: marketId.optional() }), // no marketId = lock the newest open moment market (box LOCK button)
  z.object({ action: z.literal('resolve'), marketId, outcome: outcomeId }),
  z.object({ action: z.literal('void'), marketId, reason: z.string().max(200).optional() }),
  z.object({ action: z.literal('approve_draft'), marketId }),
  z.object({ action: z.literal('discard_draft'), marketId }),
  z.object({ action: z.literal('confirm_result'), marketId }), // dispute: keep the outcome
  z.object({
    action: z.literal('set_mode'),
    mode: modeSchema,
    /** With marketId: that market only (must have no bets yet). Without: the party default. */
    marketId: marketId.optional(),
  }),
  z.object({
    action: z.literal('create_market'),
    question: z.string().min(3).max(140),
    outcomes: z.array(z.string().min(1).max(40)).min(2).max(6),
    mode: modeSchema.optional(),
    lockInSecs: z.number().int().min(5).max(7200).optional(),
    prior: z.array(z.number().min(0).max(1)).optional(),
  }),
  z.object({ action: z.literal('set_auto_approve'), value: z.boolean() }),
  z.object({ action: z.literal('set_persona'), persona: personaSchema }),
  z.object({ action: z.literal('start_game') }),
  z.object({ action: z.literal('pause_game') }),
  z.object({ action: z.literal('set_speed'), speed: z.number().min(0.25).max(20) }),
  z.object({ action: z.literal('seek'), positionMs: z.number().int().min(0) }),
  z.object({ action: z.literal('end_party') }), // final whistle override: resolve/void, close, settle
]);
export type HostAction = z.infer<typeof hostActionSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join'),
    id,
    partyCode: z.string().min(3).max(12),
    role: z.enum(['player', 'box', 'spectator']).default('player'),
    playerPubkey: pubkey.optional(),
    name: z.string().min(1).max(24).optional(),
    /** base64 signature of joinChallengeMessage(challenge, partyCode). Required for role "player". */
    signature: z.string().optional(),
    /** Required for role "box". */
    hostToken: z.string().optional(),
    remote: z.boolean().optional(),
    city: z.string().max(40).optional(),
  }),
  /** Buy in. Points/trusted-mock: credited at once. Vault: ack.data.deposit asks for a signature. */
  z.object({ type: z.literal('buy_in'), id, amount }),
  z.object({ type: z.literal('buy_in_sign'), id, depositId: z.string(), signature: z.string() }),
  /**
   * One-tap bet. pool: stake goes into the pool. amm: buys shares with `stake` as the spend.
   * bet: matches the best opposite offers, then posts the rest as an offer at the model's odds.
   */
  z.object({ type: z.literal('place_bet'), id, marketId, outcome: outcomeId, stake: amount }),
  z.object({
    type: z.literal('post_offer'),
    id,
    marketId,
    side: outcomeId,
    makerStake: amount,
    odds: z.number().min(1.01).max(50),
  }),
  z.object({ type: z.literal('take_offer'), id, offerId: z.string(), amount }),
  z.object({ type: z.literal('cancel_offer'), id, offerId: z.string() }),
  z.object({
    type: z.literal('amm_trade'),
    id,
    marketId,
    outcome: outcomeId,
    side: z.enum(['buy', 'sell']),
    /** Exactly one of shares / spend for buys; shares for sells ("all" = whole position). */
    shares: z.union([sharesStr, z.literal('all')]).optional(),
    spend: amount.optional(),
  }),
  z.object({ type: z.literal('cosign'), id, member: pubkey, nonce: z.number().int().positive(), signature: z.string() }),
  z.object({ type: z.literal('dispute'), id, marketId, reason: z.string().max(200).default('') }),
  z.object({ type: z.literal('host_action'), id, action: hostActionSchema }),
  z.object({ type: z.literal('confirm_draft'), id, draftId: z.string() }),
  z.object({ type: z.literal('reject_draft'), id, draftId: z.string() }),
  z.object({ type: z.literal('talk_start'), id }),
  z.object({ type: z.literal('talk_end'), id }),
  /** Text question for the announcer (Web Speech fallback path of the TALK button). */
  z.object({ type: z.literal('talk_text'), id, text: z.string().min(1).max(300) }),
  /** Remote sync check: "I see kickoff / the next snap" tapped at clientTs (ms epoch). */
  z.object({ type: z.literal('sync_mark'), id, clientTs: z.number() }),
  z.object({ type: z.literal('withdraw'), id, to: pubkey.optional() }),
  z.object({ type: z.literal('ping'), id }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage['type'];
/** Message body without the correlation id (what callers pass to HuddleClient.request). */
export type ClientRequest = ClientMessage extends infer M ? (M extends { id: string } ? Omit<M, 'id'> : never) : never;

export type ErrorCode =
  | 'bad_request'
  | 'not_joined'
  | 'unauthorized'
  | 'not_found'
  | 'market_closed'
  | 'insufficient_funds'
  | 'stake_limit'
  | 'min_stake'
  | 'cosign_required'
  | 'rate_limited'
  | 'party_closed'
  | 'delay_restricted'
  | 'internal';

export interface ProtocolError {
  code: ErrorCode;
  message: string;
}

/** Private per-connection view. */
export interface YouState {
  pubkey: string;
  name: string;
  /** Latest balance state (null before the first buy-in). */
  state: BalanceState | null;
  positions: Position[];
  drafts: DraftBet[];
  /** Estimated delay behind the room in ms (remote sync check); negative = ahead. */
  delayMs?: number;
  /** False when the player is too far out of sync for moment markets (PRD section 12). */
  momentMarketsAllowed: boolean;
}

export interface PartySnapshot {
  party: Party;
  players: PlayerPublic[];
  markets: Market[];
  offers: BetOffer[];
  /** Recent public fills, oldest first (max 50). */
  fills: Fill[];
  game: GameState;
  scorecard: Scorecard;
  gemini: GeminiPanel;
  replay?: ReplayStatus;
  /** Present for role "player". */
  you?: YouState;
  /** Recent announcer lines for captions (max 5). */
  announcer: AnnouncerLine[];
  serverTime: string;
  role: 'player' | 'box' | 'spectator';
}

export type ServerMessage =
  | { type: 'hello'; challenge: string; serverTime: string; version: string }
  | { type: 'ack'; id: string; ok: boolean; error?: ProtocolError; data?: Record<string, unknown> }
  | ({ type: 'party_state' } & PartySnapshot)
  | { type: 'party_update'; party: Party }
  | { type: 'market_upsert'; market: Market }
  | {
      type: 'price_update';
      marketId: string;
      price: Record<string, number>;
      volume: number;
      pool?: Record<string, number>;
      q?: Record<string, string>;
    }
  | { type: 'offer_upsert'; offer: BetOffer }
  | { type: 'fill'; fill: Fill }
  | { type: 'balance_state'; state: BalanceState } // to the member only
  | { type: 'positions'; marketId: string; positions: Position[] } // to the member only: their positions in that market
  | { type: 'leaderboard'; players: PlayerPublic[] }
  | { type: 'game_event'; event: GameEvent; state: GameState }
  | { type: 'announcer'; line: AnnouncerLine }
  | { type: 'scorecard'; scorecard: Scorecard }
  | { type: 'gemini'; panel: GeminiPanel }
  | { type: 'draft_bet'; draft: DraftBet } // to the member only
  | { type: 'draft_removed'; draftId: string }
  | { type: 'chain_event'; event: ChainEvent }
  | { type: 'replay_status'; status: ReplayStatus }
  | { type: 'led'; pattern: LedPattern; color: string } // mirrored to the box UI for the on-screen ring
  | { type: 'sync'; delayMs: number; momentMarketsAllowed: boolean } // to the member only
  | { type: 'error'; code: ErrorCode; message: string };

export type ServerMessageType = ServerMessage['type'];

/** REST: POST /parties */
export const createPartySchema = z.object({
  name: z.string().min(1).max(40).default('Watch party'),
  gameId: z.string().min(1),
  defaultMode: modeSchema.default('pool'),
  /** Human USDC amounts (e.g. 10), converted to base units by the engine. */
  buyIn: z.number().positive().max(1000).default(10),
  houseBudget: z.number().min(0).max(1000).default(20),
  persona: personaSchema.optional(),
  settlement: settlementSchema.optional(),
  requireMemberSig: z.boolean().optional(),
  autoApprove: z.boolean().optional(),
});
export type CreatePartyRequest = z.input<typeof createPartySchema>;

export interface CreatePartyResponse {
  party: Party;
  /** Secret that authorizes host actions; held by the box UI only. */
  hostToken: string;
}

export const PROTOCOL_VERSION = '1';
