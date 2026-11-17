import {
  DEFAULT_LED_COLORS,
  formatPct,
  initialGameState,
  settleClaims,
  toBase,
  type AnnouncerEvent,
  type AnnouncerLine,
  type ChainEvent,
  type ClientMessage,
  type GameEvent,
  type GameFeed,
  type GameState,
  type GeminiPanel,
  type HostAction,
  type LedPattern,
  type Market,
  type MarketCandidate,
  type Outcome,
  type PartySnapshot,
  type QuestionEngine,
  type RankedPick,
  type ReplayStatus,
  type RoomContext,
  type ServerMessage,
  type SettlementClient,
  type TalkContext,
  type YouState,
} from '@huddle/shared';
import type { Logger } from 'pino';
import { EngineError, InvariantError } from './core/errors';
import type { Effect, PartyCore } from './core/party-core';
import type { EngineAdapters, EngineTiming } from './options';
import type { RuntimeState, Store } from './store';

/**
 * One live party: wires the pure core to the outside world (sports feed, question pipeline, Gemini,
 * announcer, LEDs, WebSocket fan-out, SQLite, settlement). Core mutations are synchronous; anything
 * slow (LLM, TTS, Gemini, chain) runs detached and never sits in the bet path.
 */

export interface Conn {
  id: string;
  role: 'player' | 'box' | 'spectator';
  pubkey?: string;
  send(msg: ServerMessage): void;
}

export interface PartyDeps {
  adapters: EngineAdapters;
  timing: EngineTiming;
  store: Store;
  log: Logger;
  now: () => number;
  boxSecretKey: Uint8Array;
  settlement: SettlementClient;
  hostTokenHash: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

function slug(label: string, i: number): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || `o${i + 1}`;
}

const TRANSIENT_LEDS = new Set<LedPattern>(['join', 'market_open', 'locking', 'locked', 'win', 'loss', 'goal', 'error']);
const SYNC_EVENTS = new Set(['kickoff', 'snap']);
const MAX_RECENT_EVENTS = 100;

export class PartyRuntime {
  readonly core: PartyCore;
  game: GameState;
  gemini: GeminiPanel;
  feed: GameFeed | null = null;
  announcerLines: AnnouncerLine[] = [];
  lastSeq = 0;
  /** Unexpected errors caught while running (tests assert this stays 0). */
  internalErrors = 0;

  private readonly conns = new Set<Conn>();
  private readonly qe: QuestionEngine;
  private recentEvents: { event: GameEvent; state: GameState }[] = [];
  /** Engine time of the last kickoff/snap, the reference for remote sync checks. */
  private syncRefAt: number | null = null;
  private pendingDeposits = new Map<string, { member: string; amount: number; at: number }>();
  private seenChain = new Map<string, ChainEvent['via']>();
  private geminiAtLock = new Set<string>();
  private ledTimer: ReturnType<typeof setTimeout> | null = null;
  private ending: Promise<void> | null = null;
  private runtimeDirty = true;
  private lastReplayBroadcast = 0;
  private storedPositionMs = 0;
  private storedSpeed = 1;
  private recapSent = false;
  private hostRefund: number | undefined;
  private submitted = new Set<string>();
  private disposed = false;

  constructor(
    core: PartyCore,
    private readonly deps: PartyDeps,
    restored?: RuntimeState,
  ) {
    this.core = core;
    this.qe = deps.adapters.questionEngine();
    const g = core.party.game;
    this.game = restored?.game ?? initialGameState(g.id, g.sport, g.home, g.away);
    this.gemini = restored?.gemini ?? { available: false, source: 'none', events: [], note: 'Gemini odds not loaded yet' };
    if (restored) {
      this.lastSeq = restored.lastSeq;
      this.announcerLines = restored.announcer ?? [];
      this.storedPositionMs = restored.positionMs;
      this.storedSpeed = restored.speed || 1;
      this.recapSent = restored.recapSent ?? false;
      this.hostRefund = restored.hostRefund;
      this.submitted = new Set(restored.submitted ?? []);
    }
  }

  get code(): string {
    return this.core.party.code;
  }
  get status(): string {
    return this.core.party.status;
  }
  get hostTokenHash(): string {
    return this.deps.hostTokenHash;
  }
  get settlement(): SettlementClient {
    return this.deps.settlement;
  }
  private get log(): Logger {
    return this.deps.log;
  }
  private now(): number {
    return this.deps.now();
  }
  private scaled(ms: number): number {
    return this.core.scaled(ms);
  }

  // ───────────────────────── persistence + fan-out ─────────────────────────

  runtimeState(): RuntimeState {
    const st = this.feed?.control?.status();
    const state: RuntimeState = {
      game: this.game,
      lastSeq: this.lastSeq,
      positionMs: st?.positionMs ?? this.storedPositionMs,
      speed: st?.speed ?? this.storedSpeed,
      gemini: this.gemini,
      announcer: this.announcerLines,
      misc: this.core.misc,
      recapSent: this.recapSent,
      submitted: [...this.submitted],
    };
    if (this.hostRefund !== undefined) state.hostRefund = this.hostRefund;
    return state;
  }

  markDirty(): void {
    this.runtimeDirty = true;
  }

  /** Persist what changed, then tell clients. Call after every core mutation. */
  flush(): void {
    const effects = this.core.drainEffects();
    const dirty = this.core.drainDirty();
    const writeRuntime = dirty.party || this.runtimeDirty;
    this.runtimeDirty = false;
    try {
      this.deps.store.persist(this.core, dirty, this.deps.hostTokenHash, writeRuntime ? this.runtimeState() : null);
    } catch (e) {
      this.internalErrors++;
      this.log.error({ err: (e as Error).message, party: this.code }, 'failed to persist party state');
    }
    if (effects.length) this.fanOut(effects);
  }

  private fanOut(effects: Effect[]): void {
    const core = this.core;
    const markets = new Set<string>();
    const prices = new Set<string>();
    const offers = new Set<string>();
    const positions = new Map<string, { member: string; marketId: string }>();
    const syncs = new Set<string>();
    let party = false;
    let leaderboard = false;
    let scorecard = false;
    const leds: LedPattern[] = [];
    for (const e of effects) {
      if (e.t === 'market') markets.add(e.id);
      else if (e.t === 'price') prices.add(e.id);
      else if (e.t === 'offer') offers.add(e.id);
      else if (e.t === 'positions') positions.set(`${e.member}|${e.marketId}`, e);
      else if (e.t === 'sync') syncs.add(e.member);
      else if (e.t === 'party') party = true;
      else if (e.t === 'leaderboard') leaderboard = true;
      else if (e.t === 'scorecard') scorecard = true;
      else if (e.t === 'led' && leds.at(-1) !== e.pattern) leds.push(e.pattern);
    }
    if (party) this.broadcast({ type: 'party_update', party: core.party });
    for (const id of markets) {
      const m = core.markets.get(id)?.market;
      if (!m) continue;
      // Drafts are visible to the host only until they open.
      if (m.state === 'draft' || m.state === 'discarded') this.sendBox({ type: 'market_upsert', market: m });
      else this.broadcast({ type: 'market_upsert', market: m });
      if (m.state === 'locked' && !this.geminiAtLock.has(id)) {
        this.geminiAtLock.add(id);
        this.refreshGemini([id]);
      }
    }
    for (const id of prices) {
      if (markets.has(id)) continue;
      const m = core.markets.get(id)?.market;
      if (!m) continue;
      const msg: ServerMessage = { type: 'price_update', marketId: id, price: m.price, volume: m.volume };
      if (m.pool) msg.pool = m.pool;
      if (m.q) msg.q = m.q;
      this.broadcast(msg);
    }
    for (const id of offers) {
      const offer = core.offers.get(id);
      if (offer) this.broadcast({ type: 'offer_upsert', offer });
    }
    for (const e of effects) {
      if (e.t === 'fill') this.broadcast({ type: 'fill', fill: e.fill });
      else if (e.t === 'state') this.sendMember(e.record.state.member, { type: 'balance_state', state: e.record.state });
      else if (e.t === 'draft') this.sendMember(e.draft.player, { type: 'draft_bet', draft: e.draft });
      else if (e.t === 'draft_removed') this.sendMember(e.member, { type: 'draft_removed', draftId: e.draftId });
      else if (e.t === 'note') {
        this.log.info({ party: this.code }, e.message);
        if (e.box) this.sendBox({ type: 'error', code: 'insufficient_funds', message: e.message });
      }
    }
    for (const { member, marketId } of positions.values()) {
      this.sendMember(member, { type: 'positions', marketId, positions: core.positionsFor(member, marketId) });
    }
    for (const member of syncs) {
      const info = core.members.get(member);
      if (info) this.sendMember(member, { type: 'sync', delayMs: info.delayMs ?? 0, momentMarketsAllowed: info.momentMarketsAllowed });
    }
    if (leaderboard) this.broadcast({ type: 'leaderboard', players: core.players() });
    if (scorecard) this.broadcast({ type: 'scorecard', scorecard: core.scorecard });
    for (const e of effects) if (e.t === 'announce') this.announce(e.event);
    for (const pattern of leds) this.led(pattern);
  }

  broadcast(msg: ServerMessage): void {
    for (const c of this.conns) c.send(msg);
  }

  private sendBox(msg: ServerMessage): void {
    for (const c of this.conns) if (c.role === 'box') c.send(msg);
  }

  private sendMember(pubkey: string, msg: ServerMessage): void {
    for (const c of this.conns) if (c.role === 'player' && c.pubkey === pubkey) c.send(msg);
  }

  // ───────────────────────── announcer + LEDs ─────────────────────────

  roomContext(): RoomContext {
    const p = this.core.party;
    const g = this.game;
    return {
      partyName: p.name,
      persona: p.config.persona,
      sport: p.game.sport,
      points: p.config.settlement === 'points',
      score: `${g.home.name} ${g.score.home}, ${g.away.name} ${g.score.away}`,
      clock: g.clock.display,
      home: g.home.name,
      away: g.away.name,
      leaderboard: this.core
        .players()
        .filter((x) => !x.isHouse)
        .map((x) => ({ name: x.name, pnl: x.pnl, streak: x.streak })),
      recentResults: this.core.misc.recentResults,
    };
  }

  private talkContext(speaker?: string): TalkContext {
    const ctx: TalkContext = {
      ...this.roomContext(),
      markets: [...this.core.markets.values()].map((r) => r.market).filter((m) => m.state === 'open' || m.state === 'locked'),
    };
    const info = speaker ? this.core.members.get(speaker) : undefined;
    if (info) ctx.speaker = { pubkey: info.pubkey, name: info.name, balance: this.core.ledger.balanceOf(info.pubkey) };
    return ctx;
  }

  /** Fire and forget: the announcer never blocks game flow. */
  private announce(event: AnnouncerEvent): void {
    let ctx: RoomContext;
    try {
      ctx = this.roomContext();
    } catch {
      return;
    }
    void (async () => {
      try {
        const line = await this.deps.adapters.announcer.announce(event, ctx);
        if (line && !this.disposed) this.pushLine(line);
      } catch (e) {
        this.log.warn({ err: (e as Error).message, event: event.type }, 'announcer failed');
      }
    })();
  }

  private pushLine(line: AnnouncerLine): void {
    this.announcerLines = [...this.announcerLines, line].slice(-5);
    this.runtimeDirty = true;
    this.broadcast({ type: 'announcer', line });
  }

  /** Send an LED pattern to the box bridge and mirror it to box screens. Transient patterns fall back to idle. */
  led(pattern: LedPattern): void {
    const color = DEFAULT_LED_COLORS[pattern];
    try {
      this.deps.adapters.bridge?.send({ type: 'led', pattern, color });
    } catch {
      /* the bridge is optional */
    }
    this.sendBox({ type: 'led', pattern, color });
    if (this.ledTimer) clearTimeout(this.ledTimer);
    this.ledTimer = null;
    if (TRANSIENT_LEDS.has(pattern)) {
      this.ledTimer = setTimeout(() => {
        this.ledTimer = null;
        if (!this.disposed) this.led('idle');
      }, this.scaled(this.deps.timing.ledResetMs));
      this.ledTimer.unref?.();
    }
  }

  // ───────────────────────── connections ─────────────────────────

  attach(conn: Conn): void {
    this.conns.add(conn);
    if (conn.role === 'player' && conn.pubkey) {
      const n = (this.core.connected.get(conn.pubkey) ?? 0) + 1;
      this.core.connected.set(conn.pubkey, n);
      if (n === 1) this.broadcast({ type: 'leaderboard', players: this.core.players() });
    }
  }

  detach(conn: Conn): void {
    if (!this.conns.delete(conn)) return;
    if (conn.role === 'player' && conn.pubkey) {
      const n = Math.max(0, (this.core.connected.get(conn.pubkey) ?? 0) - 1);
      this.core.connected.set(conn.pubkey, n);
      if (n === 0 && !this.disposed) this.broadcast({ type: 'leaderboard', players: this.core.players() });
    }
  }

  snapshot(conn: Pick<Conn, 'role' | 'pubkey'>): PartySnapshot {
    const core = this.core;
    const markets = [...core.markets.values()]
      .map((r) => r.market)
      .filter((m) => m.state !== 'discarded' && (conn.role === 'box' || m.state !== 'draft'));
    const live = new Set(markets.filter((m) => m.state === 'open' || m.state === 'locked').map((m) => m.id));
    const snap: PartySnapshot = {
      party: core.party,
      players: core.players(),
      markets,
      offers: [...core.offers.values()].filter((o) => live.has(o.marketId)),
      fills: core.fills,
      game: this.game,
      scorecard: core.scorecard,
      gemini: this.gemini,
      announcer: this.announcerLines,
      serverTime: new Date(this.now()).toISOString(),
      role: conn.role,
    };
    const replay = this.feed?.control?.status();
    if (replay) snap.replay = replay;
    if (conn.role === 'player' && conn.pubkey) {
      const info = core.members.get(conn.pubkey);
      if (info) {
        // Hand over the oldest state still waiting for a countersignature so the phone can sign in order.
        const unsigned = core.ledger.unsigned(conn.pubkey);
        const you: YouState = {
          pubkey: info.pubkey,
          name: info.name,
          state: (unsigned[0] ?? core.ledger.latest(conn.pubkey))?.state ?? null,
          positions: core.positionsFor(conn.pubkey),
          drafts: core.draftsFor(conn.pubkey),
          momentMarketsAllowed: info.momentMarketsAllowed,
        };
        if (info.delayMs !== undefined) you.delayMs = info.delayMs;
        snap.you = you;
      }
    }
    return snap;
  }

  /** After (re)connect: re-send every state the member has not countersigned yet, oldest first. */
  resendUnsigned(conn: Conn): void {
    if (conn.role !== 'player' || !conn.pubkey) return;
    for (const r of this.core.ledger.unsigned(conn.pubkey).slice(1)) conn.send({ type: 'balance_state', state: r.state });
  }

  // ───────────────────────── client messages ─────────────────────────

  private player(conn: Conn): string {
    if (conn.role !== 'player' || !conn.pubkey) throw new EngineError('unauthorized', 'Only players can do that');
    return conn.pubkey;
  }

  /** Handle one validated client message. Returns the ack data. Money paths are fully synchronous. */
  async handle(conn: Conn, msg: ClientMessage): Promise<Record<string, unknown>> {
    const core = this.core;
    const now = this.now();
    try {
      switch (msg.type) {
        case 'place_bet':
          return core.placeBet(this.player(conn), msg.marketId, msg.outcome, msg.stake, now);
        case 'post_offer':
          return core.postOffer(this.player(conn), msg.marketId, msg.side, msg.makerStake, msg.odds, now);
        case 'take_offer':
          return core.takeOffer(this.player(conn), msg.offerId, msg.amount, now);
        case 'cancel_offer':
          return core.cancelOffer(this.player(conn), msg.offerId, now);
        case 'amm_trade': {
          const args: { shares?: string; spend?: number } = {};
          if (msg.shares !== undefined) args.shares = msg.shares;
          if (msg.spend !== undefined) args.spend = msg.spend;
          return core.ammTrade(this.player(conn), msg.marketId, msg.outcome, msg.side, args, now);
        }
        case 'cosign': {
          const me = this.player(conn);
          if (msg.member !== me) throw new EngineError('unauthorized', 'You can only sign your own balance');
          core.cosign(me, msg.nonce, msg.signature);
          return {};
        }
        case 'dispute':
          core.dispute(this.player(conn), msg.marketId, msg.reason, now);
          return {};
        case 'confirm_draft':
          return core.confirmDraft(this.player(conn), msg.draftId, now);
        case 'reject_draft':
          core.rejectDraft(this.player(conn), msg.draftId);
          return {};
        case 'host_action':
          if (conn.role !== 'box') throw new EngineError('unauthorized', 'Host actions need the host token');
          return this.hostAction(msg.action);
        case 'buy_in':
          return await this.buyIn(this.player(conn), msg.amount);
        case 'buy_in_sign':
          return await this.buyInSign(this.player(conn), msg.depositId, msg.signature);
        case 'talk_start':
        case 'talk_end':
        case 'ping':
          return {};
        case 'talk_text':
          this.talk(msg.text, conn.role === 'player' ? conn.pubkey : undefined);
          return {};
        case 'sync_mark': {
          const me = this.player(conn);
          if (this.syncRefAt === null) throw new EngineError('not_found', 'No kickoff or snap seen yet; try again at the next one');
          const info = core.setSync(me, msg.clientTs - this.syncRefAt);
          return { delayMs: info.delayMs, momentMarketsAllowed: info.momentMarketsAllowed };
        }
        case 'withdraw':
          return await this.withdraw(this.player(conn), msg.to);
        case 'join':
          throw new EngineError('bad_request', 'Already joined');
      }
    } finally {
      this.flush();
    }
  }

  // ───────────────────────── host ─────────────────────────

  hostAction(a: HostAction): Record<string, unknown> {
    const core = this.core;
    const now = this.now();
    try {
      switch (a.action) {
        case 'lock': {
          const id = a.marketId ?? core.newestOpen()?.id;
          if (!id) throw new EngineError('not_found', 'Nothing is open to lock');
          core.lockMarket(id, now);
          return { marketId: id };
        }
        case 'resolve':
          core.resolveMarket(a.marketId, a.outcome, now);
          return {};
        case 'void':
          core.voidMarket(a.marketId, a.reason ?? 'Voided by the host', now);
          return {};
        case 'approve_draft':
          core.openMarket(a.marketId, now);
          this.catchUp(a.marketId, now);
          return {};
        case 'discard_draft':
          core.discardDraft(a.marketId);
          return {};
        case 'confirm_result':
          core.confirmResult(a.marketId);
          return {};
        case 'set_mode':
          core.setMode(a.mode, a.marketId, now);
          return {};
        case 'create_market': {
          const used = new Set<string>();
          const outcomes: Outcome[] = a.outcomes.map((label, i) => {
            let id = slug(label, i);
            while (used.has(id)) id = `${id}_${i + 1}`;
            used.add(id);
            return { id, label };
          });
          const prior: Record<string, number> = {};
          const given = a.prior && a.prior.length === outcomes.length ? a.prior : null;
          outcomes.forEach((o, i) => (prior[o.id] = given ? given[i]! : 1 / outcomes.length));
          const input: Parameters<PartyCore['createMarket']>[0] = {
            question: a.question,
            kind: a.lockInSecs ? 'moment' : 'game',
            outcomes,
            prior,
            resolver: { type: 'manual', params: {} },
            createdBy: 'host',
            createdAtSeq: this.lastSeq,
          };
          if (a.mode) input.mode = a.mode;
          if (a.lockInSecs) input.lockAfterSecs = a.lockInSecs;
          const market = core.createMarket(input, now);
          core.openMarket(market.id, now);
          return { marketId: market.id };
        }
        case 'set_auto_approve':
          core.party.config.autoApprove = a.value;
          core.touchParty();
          return {};
        case 'set_persona':
          core.party.config.persona = a.persona;
          core.touchParty();
          void this.deps.adapters.announcer.warmup(a.persona).catch(() => undefined);
          return {};
        case 'start_game':
          return { status: this.replay('start') };
        case 'pause_game':
          return { status: this.replay('pause') };
        case 'set_speed':
          return { status: this.replay('speed', { speed: a.speed }) };
        case 'seek':
          return { status: this.replay('seek', { positionMs: a.positionMs }) };
        case 'end_party':
          void this.endParty('host');
          return {};
      }
    } finally {
      this.flush();
    }
  }

  /** Replay transport (same effect from the WS host actions and POST /replays/:id/start). */
  replay(action: 'start' | 'pause' | 'seek' | 'speed', args: { positionMs?: number; speed?: number } = {}): ReplayStatus | null {
    const st = this.core.party.status;
    if (st !== 'lobby' && st !== 'live') throw new EngineError('party_closed', 'This party is over');
    const control = this.feed?.control;
    if (action === 'start') this.core.setStatus('live');
    if (!control) {
      if (action === 'start') {
        this.flush();
        return null;
      }
      throw new EngineError('bad_request', 'This game is live; there is no replay to control');
    }
    if (action === 'start') control.start();
    else if (action === 'pause') control.pause();
    else if (action === 'seek') control.seek(args.positionMs ?? 0);
    else if (action === 'speed') control.setSpeed(args.speed ?? 1);
    const status = control.status();
    this.runtimeDirty = true;
    this.broadcast({ type: 'replay_status', status });
    this.flush();
    return status;
  }

  /** The box LOCK button: lock the newest open moment market. */
  lockButton(): void {
    try {
      this.hostAction({ action: 'lock' });
    } catch (e) {
      if (!(e instanceof EngineError)) this.unexpected(e, 'lock button');
    }
  }

  // ───────────────────────── game events + question pipeline ─────────────────────────

  private unexpected(e: unknown, where: string): void {
    this.internalErrors++;
    const err = e as Error;
    this.log.error({ err: err.message, stack: err.stack, party: this.code, invariant: e instanceof InvariantError }, `unexpected error in ${where}`);
  }

  /** Feed callback. Never throws. */
  onGameEvent = (event: GameEvent): void => {
    if (this.disposed) return;
    try {
      this.processEvent(event);
    } catch (e) {
      this.unexpected(e, 'game event');
    } finally {
      this.flush();
    }
  };

  private processEvent(event: GameEvent): void {
    const st = this.core.party.status;
    if (st !== 'lobby' && st !== 'live') return;
    if (event.seq <= this.lastSeq) return; // replay rewound or restarted: never apply an event twice
    const now = this.now();
    const prev = this.game.score;
    this.game = this.deps.adapters.sports.reduce(this.game, event);
    this.lastSeq = event.seq;
    this.runtimeDirty = true;
    if (st === 'lobby') this.core.setStatus('live');
    this.recentEvents.push({ event, state: this.game });
    if (this.recentEvents.length > MAX_RECENT_EVENTS) this.recentEvents.shift();
    if (SYNC_EVENTS.has(event.type)) this.syncRefAt = now;
    this.broadcast({ type: 'game_event', event, state: this.game });
    if (event.score.home !== prev.home || event.score.away !== prev.away || event.type === 'goal') this.led('goal');

    this.applyEvent(event, this.game, now);
    if (event.type === 'final') {
      void this.endParty('final');
      return;
    }
    this.propose(event, now);
  }

  /** Run lock triggers and resolvers for one event against the live markets (or just one). */
  private applyEvent(event: GameEvent, state: GameState, now: number, onlyId?: string): void {
    const core = this.core;
    for (const rec of [...core.markets.values()]) {
      const m = rec.market;
      if (onlyId && m.id !== onlyId) continue;
      if (m.state !== 'open' && m.state !== 'locked') continue;
      try {
        if (m.state === 'open' && this.qe.shouldLock(m, event, state)) core.lockMarket(m.id, now);
        if (m.resolver.type === 'manual') continue;
        const result = this.qe.evaluate(m, event, state);
        if (!result) continue;
        if ('outcome' in result) {
          if (m.outcomes.some((o) => o.id === result.outcome)) core.resolveMarket(m.id, result.outcome, now);
          else core.voidMarket(m.id, 'The data feed gave an unknown result', now);
        } else {
          core.voidMarket(m.id, result.reason, now);
        }
      } catch (e) {
        this.unexpected(e, `market ${m.id}`);
      }
    }
  }

  /** A market that opened late (ranking, host approval) still sees the events that arrived meanwhile. */
  private catchUp(marketId: string, now: number): void {
    const m = this.core.markets.get(marketId)?.market;
    if (!m) return;
    const from = m.createdAtSeq ?? this.lastSeq;
    for (const r of this.recentEvents) if (r.event.seq > from) this.applyEvent(r.event, r.state, now, marketId);
  }

  private isDuplicate(c: MarketCandidate): boolean {
    const key = JSON.stringify(c.resolver);
    for (const { market: m } of this.core.markets.values()) {
      if (m.state !== 'draft' && m.state !== 'open' && m.state !== 'locked') continue;
      if (m.templateId === c.templateId && JSON.stringify(m.resolver) === key) return true;
    }
    return false;
  }

  private propose(event: GameEvent, now: number): void {
    const core = this.core;
    const live = [...core.markets.values()].map((r) => r.market).filter((m) => m.state === 'draft' || m.state === 'open' || m.state === 'locked');
    let candidates: MarketCandidate[];
    try {
      candidates = this.qe.propose(event, this.game, live).filter((c) => !this.isDuplicate(c));
    } catch (e) {
      this.unexpected(e, 'question proposals');
      return;
    }
    // Game-long markets are exempt from the moment-market rate limits.
    const game = candidates.filter((c) => c.kind === 'game');
    const moment = candidates.filter((c) => c.kind === 'moment');
    if (game.length) void this.rankAndCreate(game, Math.min(4, game.length), event);
    if (moment.length && core.momentAllowed(now)) void this.rankAndCreate(moment, 2, event);
  }

  private async rankAndCreate(candidates: MarketCandidate[], maxPicks: number, event: GameEvent): Promise<void> {
    const fallback = (): RankedPick[] =>
      candidates
        .map((c, index) => ({ c, index }))
        .sort((a, b) => b.c.priority - a.c.priority)
        .slice(0, maxPicks)
        .map(({ c, index }) => ({ index, question: c.question, hook: c.hook }));
    let picks: RankedPick[] | null = null;
    try {
      picks = await withTimeout(this.deps.adapters.ranker.rank(candidates, this.roomContext(), maxPicks), this.deps.timing.rankTimeoutMs);
    } catch {
      picks = null;
    }
    if (!Array.isArray(picks) || picks.length === 0) picks = fallback();
    if (this.disposed) return;
    try {
      const seen = new Set<number>();
      for (const pick of picks.slice(0, maxPicks)) {
        const index = typeof pick?.index === 'number' ? pick.index : -1;
        const c = candidates[index];
        if (!c || seen.has(index)) continue;
        seen.add(index);
        const st = this.core.party.status;
        if (st !== 'lobby' && st !== 'live') break;
        const now = this.now();
        if (c.kind === 'moment' && !this.core.momentAllowed(now)) break;
        if (this.isDuplicate(c)) continue;
        this.createFromCandidate(c, pick, event, now);
      }
    } catch (e) {
      this.unexpected(e, 'market creation');
    } finally {
      this.flush();
    }
  }

  private createFromCandidate(c: MarketCandidate, pick: RankedPick, event: GameEvent, now: number): Market {
    const core = this.core;
    const text = (s: unknown, fallbackText: string, max: number): string => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : fallbackText);
    const input: Parameters<PartyCore['createMarket']>[0] = {
      question: text(pick.question, c.question, 140),
      hook: text(pick.hook, c.hook, 200),
      kind: c.kind,
      outcomes: c.outcomes,
      prior: c.prior, // the model's numbers; the LLM never touches them
      resolver: c.resolver,
      createdBy: 'ai',
      templateId: c.templateId,
      createdAtSeq: event.seq,
    };
    const lockSecs = c.lockAfterSecs ?? (c.kind === 'moment' && !c.lockOnEvent ? core.config.momentLockSecs : undefined);
    if (lockSecs !== undefined) input.lockAfterSecs = lockSecs;
    if (c.lockOnEvent) input.lockOnEvent = c.lockOnEvent;
    if (c.rationale) input.rationale = c.rationale;
    if (c.geminiHint) {
      input.geminiHint = c.geminiHint;
      try {
        const ref = this.deps.adapters.gemini.refFor(this.gemini, c.geminiHint, c.outcomes, core.party.game);
        if (ref) input.geminiRef = ref;
      } catch {
        /* no Gemini comparison for this market */
      }
    }
    const market = core.createMarket(input, now);
    if (core.config.autoApprove) {
      core.openMarket(market.id, now);
      this.catchUp(market.id, now);
    }
    return market;
  }

  // ───────────────────────── Gemini ─────────────────────────

  /** Optional model calibration against the matched Gemini quotes (P1 hook in @huddle/models). */
  calibrate(): void {
    try {
      this.qe.calibrate?.(this.core.party.game, this.gemini.events);
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'model calibration failed');
    }
  }

  setGemini(panel: GeminiPanel): void {
    this.gemini = panel;
    this.runtimeDirty = true;
    this.broadcast({ type: 'gemini', panel });
  }

  private applyGeminiRef(marketId: string): void {
    const rec = this.core.markets.get(marketId);
    if (!rec?.book.geminiHint) return;
    try {
      const ref = this.deps.adapters.gemini.refFor(this.gemini, rec.book.geminiHint, rec.market.outcomes, this.core.party.game);
      const cur = rec.market.geminiRef;
      if (ref && (cur?.prob !== ref.prob || cur?.asOf !== ref.asOf || cur?.contractTicker !== ref.contractTicker)) {
        this.core.setGeminiRef(marketId, ref);
      }
    } catch {
      /* keep the previous ref */
    }
  }

  /**
   * Refresh Gemini quotes in the background. `lockIds` are markets that just locked: their ref is
   * updated from this fetch so the scorecard uses Gemini's price at lock. Open markets always follow.
   */
  refreshGemini(lockIds: string[] = []): void {
    if (this.disposed || !this.gemini.available) return;
    void (async () => {
      try {
        const panel = await this.deps.adapters.gemini.refresh(this.gemini);
        if (this.disposed || !panel) return;
        this.setGemini(panel);
        for (const id of lockIds) this.applyGeminiRef(id);
        for (const { market } of this.core.markets.values()) if (market.state === 'open') this.applyGeminiRef(market.id);
        this.flush();
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'gemini refresh failed');
      }
    })();
  }

  // ───────────────────────── deposits + chain events ─────────────────────────

  private prunePending(now: number): void {
    for (const [id, p] of this.pendingDeposits) if (now - p.at > 120_000) this.pendingDeposits.delete(id);
  }

  private pendingFor(member: string): number {
    let s = 0;
    for (const p of this.pendingDeposits.values()) if (p.member === member) s += p.amount;
    return s;
  }

  async buyIn(member: string, amount: number): Promise<Record<string, unknown>> {
    const core = this.core;
    const st = core.party.status;
    if (st !== 'lobby' && st !== 'live') throw new EngineError('party_closed', 'Buy-ins are closed for this party');
    const acct = core.ledger.accounts.get(member);
    if (!acct) throw new EngineError('not_joined', 'Join the party first');
    this.prunePending(Date.now());
    if (acct.deposited + this.pendingFor(member) + amount > core.config.maxBuyIn) {
      throw new EngineError('stake_limit', `The host capped buy-ins at ${(core.config.maxBuyIn / 1_000_000).toFixed(2)} per player`);
    }
    const hold = `hold:${member}:${Date.now()}:${Math.random()}`;
    this.pendingDeposits.set(hold, { member, amount, at: Date.now() });
    try {
      const req = await this.settlement.prepareDeposit({ partyAddress: core.party.chain.partyAddress, member, amount });
      if (req.messageB64 === null) {
        const res = await this.settlement.submitDeposit({ depositId: req.depositId });
        this.confirmDeposit(member, res.amount, res.txSig ?? `direct:${req.depositId}`, 'direct');
        return { credited: true, txSig: res.txSig };
      }
      this.pendingDeposits.set(req.depositId, { member, amount, at: Date.now() });
      return { deposit: { depositId: req.depositId, messageB64: req.messageB64 } };
    } catch (e) {
      if (e instanceof EngineError) throw e;
      this.log.warn({ err: (e as Error).message, party: this.code }, 'deposit failed');
      throw new EngineError('internal', `Deposit failed: ${(e as Error).message}`);
    } finally {
      this.pendingDeposits.delete(hold);
    }
  }

  async buyInSign(member: string, depositId: string, signature: string): Promise<Record<string, unknown>> {
    const pending = this.pendingDeposits.get(depositId);
    if (!pending || pending.member !== member) throw new EngineError('not_found', 'No such pending deposit');
    try {
      const res = await this.settlement.submitDeposit({ depositId, memberSignatureB64: signature });
      this.confirmDeposit(member, res.amount, res.txSig ?? `direct:${depositId}`, 'direct');
      return { credited: true, txSig: res.txSig };
    } catch (e) {
      if (e instanceof EngineError) throw e;
      this.log.warn({ err: (e as Error).message, party: this.code }, 'deposit failed');
      throw new EngineError('internal', `Deposit failed: ${(e as Error).message}`);
    } finally {
      this.pendingDeposits.delete(depositId);
    }
  }

  /** The one place deposits are credited. Idempotent on the transaction signature. */
  confirmDeposit(member: string, amount: number, signature: string, via: ChainEvent['via'], source?: ChainEvent): boolean {
    let credited = false;
    try {
      credited = this.core.creditDeposit(member, amount, signature, this.now());
    } catch (e) {
      // A malformed event (bad wallet, bad amount) is dropped; anything else is a bug worth counting.
      if (e instanceof EngineError) {
        this.log.warn({ party: this.code, reason: e.message }, 'deposit event ignored');
        return false;
      }
      this.unexpected(e, 'deposit credit');
      return false;
    }
    // Keep slot, block time and explorer link when the confirmation came from the chain.
    const ev: ChainEvent = { ...source, kind: 'deposit', signature, partyAddress: this.core.party.chain.partyAddress, member, amount, via };
    this.noteChain(ev);
    this.flush();
    return credited;
  }

  /** A program event from QuickNode Streams, the RPC log subscription, or the mock. */
  onChainEvent(e: ChainEvent): void {
    if (this.disposed) return;
    if (e.kind === 'deposit' && e.member && typeof e.amount === 'number' && e.amount > 0) {
      this.confirmDeposit(e.member, e.amount, e.signature, e.via, e);
      return;
    }
    this.noteChain(e);
  }

  /**
   * Broadcast an on-chain step once per signature. A later sighting through QuickNode Streams is
   * re-broadcast once so screens can show Streams as the source.
   */
  private noteChain(e: ChainEvent): void {
    const prev = this.seenChain.get(e.signature + e.kind);
    if (prev && !(e.via === 'quicknode' && prev !== 'quicknode')) return;
    this.seenChain.set(e.signature + e.kind, e.via);
    const event: ChainEvent = { ...e };
    if (!event.explorerUrl) {
      const url = this.settlement.explorerUrl(e.signature);
      if (url) event.explorerUrl = url;
    }
    this.broadcast({ type: 'chain_event', event });
  }

  private step(kind: ChainEvent['kind'], txSig: string | undefined, extra: { member?: string; amount?: number } = {}): void {
    if (!txSig) return;
    this.noteChain({ kind, signature: txSig, partyAddress: this.core.party.chain.partyAddress, via: 'direct', ...extra });
  }

  // ───────────────────────── talk (voice fallback) ─────────────────────────

  /** TALK fallback: answer out loud; a bet request only ever becomes a draft the player must confirm. */
  private talk(text: string, speaker: string | undefined): void {
    const ctx = this.talkContext(speaker);
    void (async () => {
      try {
        const reply = await this.deps.adapters.announcer.answer(text, ctx);
        if (this.disposed || !reply) return;
        if (reply.text) this.announce({ type: 'talk_reply', text: reply.text });
        if (reply.draft && speaker) {
          try {
            this.core.addDraft(speaker, reply.draft.marketId, reply.draft.outcome, reply.draft.amount, 'voice', this.now());
          } catch (e) {
            if (!(e instanceof EngineError)) throw e;
            this.log.info({ party: this.code, reason: e.message }, 'voice draft dropped');
          }
          this.flush();
        }
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'talk failed');
      }
    })();
  }

  // ───────────────────────── agent tools (ElevenLabs server tools) ─────────────────────────

  private marketSummary(m: Market): Record<string, unknown> {
    return {
      id: m.id,
      question: m.question,
      kind: m.kind,
      mode: m.mode,
      state: m.state,
      outcomes: m.outcomes.map((o) => ({ id: o.id, label: o.label, price: m.price[o.id] ?? 0, percent: formatPct(m.price[o.id] ?? 0) })),
      volume_usdc: m.volume / 1_000_000,
      locks_at: m.lock.at ?? null,
      gemini: m.geminiRef ? { label: m.geminiRef.label ?? m.geminiRef.contractTicker, prob: m.geminiRef.prob, as_of: m.geminiRef.asOf } : null,
    };
  }

  toolPartyState(): Record<string, unknown> {
    const g = this.game;
    return {
      party: this.core.party.name,
      status: this.core.party.status,
      points_only: this.core.config.settlement === 'points',
      score: { home: g.home.name, away: g.away.name, home_score: g.score.home, away_score: g.score.away },
      clock: g.clock.display,
      open_markets: [...this.core.markets.values()].filter((r) => r.market.state === 'open').map((r) => this.marketSummary(r.market)),
      leaderboard: this.core
        .players()
        .filter((p) => !p.isHouse)
        .map((p) => ({ name: p.name, balance_usdc: p.balance / 1_000_000, pnl_usdc: p.pnl / 1_000_000 })),
    };
  }

  toolMarket(marketId: string): Record<string, unknown> {
    const m = this.core.rec(marketId).market;
    if (m.state === 'draft' || m.state === 'discarded') throw new EngineError('not_found', 'No such market');
    return this.marketSummary(m);
  }

  toolExplain(marketId: string): Record<string, unknown> {
    const rec = this.core.rec(marketId);
    let explanation: string;
    try {
      explanation = this.qe.explain(rec.market, this.game);
    } catch {
      explanation = rec.book.rationale ?? 'The starting price comes from our historical model for this kind of play.';
    }
    return { market_id: marketId, question: rec.market.question, explanation };
  }

  /** Agent `draft_bet`: creates a draft only. `amountUsdc` is a human amount (5 = 5 USDC). */
  toolDraftBet(boundPlayer: string | undefined, playerRef: string | undefined, marketId: string, outcome: string, amountUsdc: number): Record<string, unknown> {
    let pubkey = boundPlayer;
    if (!pubkey && playerRef) {
      const want = playerRef.trim().toLowerCase();
      for (const m of this.core.members.values()) {
        if (!m.isHouse && (m.pubkey === playerRef || m.name.toLowerCase() === want)) pubkey = m.pubkey;
      }
    }
    if (!pubkey) throw new EngineError('not_found', 'I do not know which player that is');
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) throw new EngineError('bad_request', 'Invalid amount');
    try {
      const draft = this.core.addDraft(pubkey, marketId, outcome, toBase(amountUsdc), 'voice', this.now());
      return { ok: true, draft_id: draft.id, needs_confirmation: true, message: 'Draft created. The player must confirm it in the app.' };
    } finally {
      this.flush();
    }
  }

  // ───────────────────────── tick ─────────────────────────

  tick(): void {
    if (this.disposed) return;
    const st = this.core.party.status;
    if (st === 'finalized' || st === 'closing') return;
    try {
      this.core.tick(this.now());
      const replay = this.feed?.control?.status();
      if (replay?.playing && Date.now() - this.lastReplayBroadcast > 2000) {
        this.lastReplayBroadcast = Date.now();
        this.runtimeDirty = true;
        this.broadcast({ type: 'replay_status', status: replay });
      }
    } catch (e) {
      this.unexpected(e, 'tick');
    } finally {
      this.flush();
    }
  }

  // ───────────────────────── end of game + settlement ─────────────────────────

  private async waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    while (!this.disposed) {
      if (pred()) return true;
      if (Date.now() >= until) return false;
      await sleep(Math.min(this.deps.timing.tickMs, 50));
    }
    return false;
  }

  /** Final whistle or host `end_party`. Safe to call again: it resumes where it stopped. */
  endParty(reason: 'final' | 'host' | 'resume'): Promise<void> {
    if (!this.ending) {
      this.ending = this.runEnd(reason)
        .catch((e) => {
          this.unexpected(e, 'end of party');
          this.sendBox({ type: 'error', code: 'internal', message: `Settlement stopped: ${(e as Error).message}. Close the party again to retry.` });
        })
        .finally(() => {
          this.ending = null;
        });
    }
    return this.ending;
  }

  /** Void open/locked moment markets after the box was offline (PRD section 12). Returns how many. */
  voidAfterOutage(downSecs: number): number {
    const now = this.now();
    let n = 0;
    for (const m of this.marketsIn('open', 'locked')) {
      if (m.kind !== 'moment') continue;
      try {
        this.core.voidMarket(m.id, `The box was offline for ${downSecs} s, so this moment could not be called fairly`, now);
        n++;
      } catch (e) {
        this.unexpected(e, `void ${m.id} after outage`);
      }
    }
    if (n > 0) this.flush();
    return n;
  }

  private marketsIn(...states: string[]): Market[] {
    return [...this.core.markets.values()].map((r) => r.market).filter((m) => states.includes(m.state));
  }

  private async runEnd(reason: string): Promise<void> {
    const core = this.core;
    this.log.info({ party: this.code, reason }, 'ending party');
    if (core.party.status === 'lobby' || core.party.status === 'live') {
      core.setStatus('ended');
      this.feed?.control?.pause();
      const now = this.now();
      // Whatever has not resolved by now is void: every stake and trade goes back at cost.
      for (const m of this.marketsIn('draft', 'open', 'locked')) {
        try {
          core.voidMarket(m.id, 'No result by the end of the game', now);
        } catch (e) {
          this.unexpected(e, `void ${m.id}`);
        }
      }
      this.flush();
    }
    if (core.party.status === 'ended') {
      const disputeMs = this.scaled(core.config.disputeSecs * 1000);
      await this.waitFor(() => this.marketsIn('resolved').length === 0, disputeMs + 2000);
      await this.waitFor(() => this.marketsIn('disputed').length === 0, this.scaled(this.deps.timing.disputeDecisionMs));
      if (this.disposed) return;
      const now = this.now();
      for (const m of this.marketsIn('disputed')) core.voidMarket(m.id, 'Dispute not settled before the party closed', now);
      for (const m of this.marketsIn('resolved')) core.finalizeMarket(m.id);
      if (!this.recapSent) {
        this.recapSent = true;
        this.runtimeDirty = true;
        const g = this.game;
        const ev: AnnouncerEvent = {
          type: 'game_recap',
          scorecard: core.scorecard,
          leaderboard: core
            .players()
            .filter((p) => !p.isHouse)
            .map((p) => ({ name: p.name, pnl: p.pnl })),
          finalScore: `${g.home.name} ${g.score.home}, ${g.away.name} ${g.score.away}`,
        };
        if (core.misc.biggestSwing) ev.biggestSwing = core.misc.biggestSwing;
        this.announce(ev);
      }
      core.ledger.assertInvariant();
      core.setStatus('closing');
      this.flush();
    }
    if (core.party.status === 'closing') await this.settle();
  }

  private claimFor(member: string): { nonce: number; balance: number; stateHash: string; boxSig: string; memberSig?: string } | null {
    const rec = this.core.config.requireMemberSig ? this.core.ledger.latestSigned(member) : this.core.ledger.latest(member);
    if (!rec) return null;
    const s = rec.state;
    const claim: { nonce: number; balance: number; stateHash: string; boxSig: string; memberSig?: string } = {
      nonce: s.nonce,
      balance: s.balance,
      stateHash: s.stateHash,
      boxSig: s.boxSig,
    };
    if (s.memberSig) claim.memberSig = s.memberSig;
    return claim;
  }

  /** request_close -> wait for countersignatures -> submit_state for all -> challenge window -> finalize -> withdraw. */
  private async settle(): Promise<void> {
    const core = this.core;
    const addr = core.party.chain.partyAddress;
    const members = [...core.members.values()];
    const offChain = /mock|points/i.test(this.settlement.label);

    let challengeEndsAt: string | undefined = core.party.chain.challengeEndsAt;
    try {
      const r = await this.settlement.requestClose(addr, this.deps.boxSecretKey);
      challengeEndsAt = r.challengeEndsAt;
      if (r.txSig) core.party.chain.closeTx = r.txSig;
      core.party.chain.challengeEndsAt = r.challengeEndsAt;
      core.touchParty();
      this.step('request_close', r.txSig);
      this.flush();
    } catch (e) {
      // An in-memory vault forgets parties when the engine restarts; points need no chain anyway.
      if (!offChain) throw e;
      this.log.warn({ party: this.code, err: (e as Error).message }, 'settlement client does not know this party; settling locally');
      await this.waitForCosigns();
      this.settleLocally();
      return;
    }

    await this.waitForCosigns();
    if (this.disposed) return;

    for (const m of members) {
      const acct = core.ledger.accounts.get(m.pubkey);
      if (!acct || acct.deposited <= 0 || this.submitted.has(m.pubkey)) continue;
      const claim = this.claimFor(m.pubkey);
      if (!claim) continue; // no (countersigned) state: the vault defaults to the deposit
      try {
        const r = await this.settlement.submitState(addr, { member: m.pubkey, ...claim });
        this.submitted.add(m.pubkey);
        this.runtimeDirty = true;
        this.step('submit_state', r.txSig, { member: m.pubkey, amount: claim.balance });
      } catch (e) {
        this.log.warn({ party: this.code, member: m.pubkey, err: (e as Error).message }, 'submit_state failed');
      }
    }
    this.flush();

    if (challengeEndsAt) await this.waitFor(() => Date.now() >= Date.parse(challengeEndsAt!) + 25, Date.parse(challengeEndsAt) - Date.now() + 5000);
    if (this.disposed) return;

    let fin: Awaited<ReturnType<SettlementClient['finalize']>> | null = null;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 8 && !fin && !this.disposed; attempt++) {
      try {
        fin = await this.settlement.finalize(addr);
      } catch (e) {
        lastErr = e;
        await sleep(Math.min(4000, 150 * 2 ** attempt));
      }
    }
    if (this.disposed) return;
    if (!fin) throw lastErr instanceof Error ? lastErr : new Error('finalize failed');
    if (fin.txSig) core.party.chain.finalizeTx = fin.txSig;
    this.hostRefund = fin.hostRefund;
    this.step('finalize', fin.txSig);

    for (const m of members) {
      let payout = fin.payouts[m.pubkey] ?? 0;
      // Whatever the vault returns to the host beyond the bond is house money (surplus, dust).
      if (m.isHouse) payout += Math.max(0, fin.hostRefund - core.config.bond);
      const onChainMember = (core.ledger.accounts.get(m.pubkey)?.deposited ?? 0) > 0;
      let tx: string | undefined;
      if (onChainMember) {
        try {
          const w = await this.settlement.withdraw(addr, m.pubkey);
          tx = w.txSig;
          this.step('withdraw', w.txSig, { member: m.pubkey, amount: w.amount });
        } catch (e) {
          this.log.warn({ party: this.code, member: m.pubkey, err: (e as Error).message }, 'withdraw failed');
        }
      }
      core.setPayout(m.pubkey, payout, tx);
    }
    this.finish();
  }

  private async waitForCosigns(): Promise<void> {
    const core = this.core;
    if (!core.config.requireMemberSig) return;
    const pending = (): boolean => {
      for (const m of core.members.values()) {
        if (m.isHouse || (core.connected.get(m.pubkey) ?? 0) === 0) continue;
        if (core.ledger.unsigned(m.pubkey).length > 0) return true;
      }
      return false;
    };
    await this.waitFor(() => !pending(), this.scaled(this.deps.timing.cosignWaitMs));
  }

  /** Same rules as the vault's finalize, run on our own ledger (points, or a mock vault after a restart). */
  private settleLocally(): void {
    const core = this.core;
    const deposits: Record<string, number> = {};
    const claims: Record<string, number | undefined> = {};
    for (const m of core.members.values()) {
      const acct = core.ledger.accounts.get(m.pubkey);
      if (!acct) continue;
      if (acct.deposited > 0) {
        deposits[m.pubkey] = acct.deposited;
        claims[m.pubkey] = this.claimFor(m.pubkey)?.balance;
      }
    }
    const res = settleClaims({ deposits, claims, bond: core.config.bond });
    this.hostRefund = res.hostRefund;
    for (const m of core.members.values()) {
      let payout = res.payouts[m.pubkey] ?? 0;
      if (m.isHouse) payout += Math.max(0, res.hostRefund - core.config.bond);
      core.setPayout(m.pubkey, payout);
    }
    this.finish();
  }

  private finish(): void {
    this.core.setStatus('finalized');
    this.runtimeDirty = true;
    this.flush();
    this.feed?.stop();
    this.led('idle');
    this.log.info({ party: this.code }, 'party finalized');
  }

  /** P1: payouts already land in the player's wallet at finalize; external wallets are not supported yet. */
  private async withdraw(member: string, to: string | undefined): Promise<Record<string, unknown>> {
    const core = this.core;
    const info = core.members.get(member);
    if (!info) throw new EngineError('not_joined', 'Join the party first');
    if (core.config.settlement === 'points') return { points: true, note: 'Points parties have nothing to withdraw' };
    if (to && to !== member) {
      throw new EngineError('bad_request', 'Withdrawing to another wallet is not available yet. Your winnings land in your Huddle wallet automatically.');
    }
    if (core.party.status !== 'finalized') {
      throw new EngineError('bad_request', 'Winnings are paid out automatically when the party is settled');
    }
    if (info.withdrawTx) return { txSig: info.withdrawTx, amount: info.payout ?? 0 };
    try {
      const w = await this.settlement.withdraw(core.party.chain.partyAddress, member);
      core.setPayout(member, info.payout ?? w.amount, w.txSig);
      this.step('withdraw', w.txSig, { member, amount: w.amount });
      return { txSig: w.txSig, amount: w.amount };
    } catch (e) {
      throw new EngineError('internal', `Withdraw failed: ${(e as Error).message}`);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.ledTimer) clearTimeout(this.ledTimer);
    try {
      this.feed?.stop();
    } catch {
      /* already stopped */
    }
  }
}
