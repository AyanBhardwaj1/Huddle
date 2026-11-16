import type { AnnouncerLine } from './announcer';
import type { LedPattern } from './bridge';
import type { GameEvent } from './events';
import type { ClientRequest, PartySnapshot, ProtocolError, ServerMessage } from './protocol';
import { checkBalanceState, joinChallengeMessage, randomId, signBytes, signState, type KeyPair } from './state';
import type { BalanceState, ChainEvent, Fill } from './types';

/**
 * Framework-free WebSocket client used by the player app, the box UI, bots and tests.
 * Handles the hello/join handshake, request/ack correlation, reconnects, a reduced view of the
 * party, and automatic countersigning of balance states (PRD section 8).
 */

export interface ClientView {
  status: 'idle' | 'connecting' | 'joining' | 'ready' | 'reconnecting' | 'closed';
  snapshot: PartySnapshot | null;
  /** Last countersigned state; the base for checking the next one. */
  lastSigned: BalanceState | null;
  /** Set when a balance state failed the check: show a dispute prompt instead of signing. */
  cosignMismatch: { state: BalanceState; reason: string } | null;
  lastError: ProtocolError | null;
  lastGameEvent: GameEvent | null;
  chainEvents: ChainEvent[];
  led: { pattern: LedPattern; color: string } | null;
  /** Offset to add to Date.now() to get engine time (ms). */
  clockSkewMs: number;
}

export interface HuddleClientOptions {
  /** ws:// or wss:// URL of the engine's /ws endpoint. */
  url: string;
  partyCode: string;
  role?: 'player' | 'box' | 'spectator';
  /** Player wallet. Required for role "player". */
  keyPair?: KeyPair;
  name?: string;
  hostToken?: string;
  remote?: boolean;
  city?: string;
  /** Countersign balance states automatically (default true). */
  autoCosign?: boolean;
  /** Previously persisted last-signed state (survives reloads). */
  lastSigned?: BalanceState | null;
  onLastSigned?: (state: BalanceState) => void;
  onAnnouncer?: (line: AnnouncerLine) => void;
  onFill?: (fill: Fill) => void;
  onMessage?: (msg: ServerMessage) => void;
  reconnect?: boolean;
  /** Defaults to globalThis.WebSocket (browsers, Node 22+). */
  WebSocketCtor?: typeof WebSocket;
  ackTimeoutMs?: number;
}

export class RequestError extends Error {
  constructor(public readonly error: ProtocolError) {
    super(error.message);
    this.name = 'RequestError';
  }
  get code(): ProtocolError['code'] {
    return this.error.code;
  }
}

type Pending = { resolve: (d: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const MAX_FILLS = 50;
const MAX_CAPTIONS = 5;

export class HuddleClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private closedByUser = false;
  private retry = 0;
  private view: ClientView;

  constructor(private readonly opts: HuddleClientOptions) {
    this.view = {
      status: 'idle',
      snapshot: null,
      lastSigned: opts.lastSigned ?? null,
      cosignMismatch: null,
      lastError: null,
      lastGameEvent: null,
      chainEvents: [],
      led: null,
      clockSkewMs: 0,
    };
  }

  // ----- store API (works with React's useSyncExternalStore) -----
  getView = (): ClientView => this.view;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(patch: Partial<ClientView>): void {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }
  private patchSnapshot(fn: (s: PartySnapshot) => PartySnapshot): void {
    if (!this.view.snapshot) return;
    this.set({ snapshot: fn(this.view.snapshot) });
  }

  /** Engine time in ms. */
  now(): number {
    return Date.now() + this.view.clockSkewMs;
  }

  connect(): void {
    this.closedByUser = false;
    const Ctor = this.opts.WebSocketCtor ?? globalThis.WebSocket;
    if (!Ctor) throw new Error('no WebSocket implementation available');
    this.set({ status: this.retry > 0 ? 'reconnecting' : 'connecting' });
    const ws = new Ctor(this.opts.url);
    this.ws = ws;
    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('connection closed'));
      }
      this.pending.clear();
      if (this.closedByUser || this.opts.reconnect === false) {
        this.set({ status: 'closed' });
        return;
      }
      this.retry += 1;
      this.set({ status: 'reconnecting' });
      setTimeout(() => !this.closedByUser && this.connect(), Math.min(5000, 300 * 2 ** Math.min(this.retry, 4)));
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  /** Send a request and wait for its ack. Rejects with RequestError when the engine says no. */
  request(body: ClientRequest): Promise<Record<string, unknown>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('not connected'));
    const id = randomId(6);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('request timed out'));
      }, this.opts.ackTimeoutMs ?? 8000);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ ...body, id }));
    });
  }

  /** Resolves once the first party_state has arrived. */
  ready(timeoutMs = 8000): Promise<PartySnapshot> {
    if (this.view.status === 'ready' && this.view.snapshot) return Promise.resolve(this.view.snapshot);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(this.view.lastError?.message ?? 'timed out waiting for party state'));
      }, timeoutMs);
      const unsub = this.subscribe(() => {
        if (this.view.status === 'ready' && this.view.snapshot) {
          clearTimeout(timer);
          unsub();
          resolve(this.view.snapshot);
        }
      });
    });
  }

  /** Buy in. Handles the sign-and-submit round trip in vault mode. */
  async buyIn(amount: number): Promise<void> {
    const data = await this.request({ type: 'buy_in', amount });
    const deposit = data.deposit as { depositId: string; messageB64: string | null } | undefined;
    if (deposit?.messageB64) {
      if (!this.opts.keyPair) throw new Error('wallet required');
      const bytes = Uint8Array.from(atob(deposit.messageB64), (c) => c.charCodeAt(0));
      const signature = signBytes(bytes, this.opts.keyPair.secretKey);
      await this.request({ type: 'buy_in_sign', depositId: deposit.depositId, signature });
    }
  }

  private async sendJoin(challenge: string): Promise<void> {
    const { partyCode, keyPair, role = 'player' } = this.opts;
    this.set({ status: 'joining' });
    try {
      await this.request({
        type: 'join',
        partyCode,
        role,
        playerPubkey: keyPair?.publicKey,
        name: this.opts.name,
        signature: keyPair ? signBytes(joinChallengeMessage(challenge, partyCode), keyPair.secretKey) : undefined,
        hostToken: this.opts.hostToken,
        remote: this.opts.remote,
        city: this.opts.city,
      });
      this.retry = 0;
    } catch (e) {
      const error: ProtocolError =
        e instanceof RequestError ? e.error : { code: 'internal', message: (e as Error).message };
      this.set({ lastError: error });
    }
  }

  private cosign(state: BalanceState): void {
    const snap = this.view.snapshot;
    const kp = this.opts.keyPair;
    if (!snap || !kp || state.member !== kp.publicKey) return;
    if (this.view.lastSigned && state.nonce <= this.view.lastSigned.nonce) return; // already signed
    const party = snap.party.chain.partyAddress;
    const check = checkBalanceState(state, party, snap.party.boxSigner, this.view.lastSigned);
    if (!check.ok) {
      this.set({ cosignMismatch: { state, reason: check.reason } });
      return;
    }
    const signature = signState(
      { party, member: state.member, nonce: state.nonce, balance: state.balance, stateHash: state.stateHash },
      kp.secretKey,
    );
    const signed = { ...state, memberSig: signature };
    this.set({ lastSigned: signed, cosignMismatch: null });
    this.opts.onLastSigned?.(signed);
    this.request({ type: 'cosign', member: state.member, nonce: state.nonce, signature }).catch(() => {
      /* the engine re-sends unsigned states on reconnect */
    });
  }

  private handle(msg: ServerMessage): void {
    this.opts.onMessage?.(msg);
    switch (msg.type) {
      case 'hello':
        this.set({ clockSkewMs: Date.parse(msg.serverTime) - Date.now() });
        void this.sendJoin(msg.challenge);
        break;
      case 'ack': {
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.data ?? {});
        else {
          const error = msg.error ?? { code: 'internal' as const, message: 'request failed' };
          this.set({ lastError: error });
          p.reject(new RequestError(error));
        }
        break;
      }
      case 'party_state': {
        const { type: _t, ...snapshot } = msg;
        this.set({
          snapshot,
          status: 'ready',
          lastError: null,
          clockSkewMs: Date.parse(snapshot.serverTime) - Date.now(),
        });
        // Catch up on a state we have not countersigned yet.
        const st = snapshot.you?.state;
        if (st && !st.memberSig && this.opts.autoCosign !== false) this.cosign(st);
        break;
      }
      case 'party_update':
        this.patchSnapshot((s) => ({ ...s, party: msg.party }));
        break;
      case 'market_upsert':
        this.patchSnapshot((s) => {
          const i = s.markets.findIndex((m) => m.id === msg.market.id);
          const markets = i >= 0 ? s.markets.map((m, j) => (j === i ? msg.market : m)) : [...s.markets, msg.market];
          return { ...s, markets };
        });
        break;
      case 'price_update':
        this.patchSnapshot((s) => ({
          ...s,
          markets: s.markets.map((m) =>
            m.id === msg.marketId
              ? { ...m, price: msg.price, volume: msg.volume, pool: msg.pool ?? m.pool, q: msg.q ?? m.q }
              : m,
          ),
        }));
        break;
      case 'offer_upsert':
        this.patchSnapshot((s) => {
          const i = s.offers.findIndex((o) => o.id === msg.offer.id);
          const offers = i >= 0 ? s.offers.map((o, j) => (j === i ? msg.offer : o)) : [...s.offers, msg.offer];
          return { ...s, offers };
        });
        break;
      case 'fill':
        this.patchSnapshot((s) => ({ ...s, fills: [...s.fills, msg.fill].slice(-MAX_FILLS) }));
        this.opts.onFill?.(msg.fill);
        break;
      case 'balance_state':
        this.patchSnapshot((s) => (s.you ? { ...s, you: { ...s.you, state: msg.state } } : s));
        if (this.opts.autoCosign !== false) this.cosign(msg.state);
        break;
      case 'positions':
        this.patchSnapshot((s) =>
          s.you
            ? {
                ...s,
                you: {
                  ...s.you,
                  positions: [...s.you.positions.filter((p) => p.marketId !== msg.marketId), ...msg.positions],
                },
              }
            : s,
        );
        break;
      case 'leaderboard':
        this.patchSnapshot((s) => ({ ...s, players: msg.players }));
        break;
      case 'game_event':
        this.patchSnapshot((s) => ({ ...s, game: msg.state }));
        this.set({ lastGameEvent: msg.event });
        break;
      case 'announcer':
        this.patchSnapshot((s) => ({ ...s, announcer: [...s.announcer, msg.line].slice(-MAX_CAPTIONS) }));
        this.opts.onAnnouncer?.(msg.line);
        break;
      case 'scorecard':
        this.patchSnapshot((s) => ({ ...s, scorecard: msg.scorecard }));
        break;
      case 'gemini':
        this.patchSnapshot((s) => ({ ...s, gemini: msg.panel }));
        break;
      case 'draft_bet':
        this.patchSnapshot((s) =>
          s.you ? { ...s, you: { ...s.you, drafts: [...s.you.drafts.filter((d) => d.id !== msg.draft.id), msg.draft] } } : s,
        );
        break;
      case 'draft_removed':
        this.patchSnapshot((s) =>
          s.you ? { ...s, you: { ...s.you, drafts: s.you.drafts.filter((d) => d.id !== msg.draftId) } } : s,
        );
        break;
      case 'chain_event':
        this.set({ chainEvents: [...this.view.chainEvents, msg.event].slice(-30) });
        break;
      case 'replay_status':
        this.patchSnapshot((s) => ({ ...s, replay: msg.status }));
        break;
      case 'led':
        this.set({ led: { pattern: msg.pattern, color: msg.color } });
        break;
      case 'sync':
        this.patchSnapshot((s) =>
          s.you ? { ...s, you: { ...s.you, delayMs: msg.delayMs, momentMarketsAllowed: msg.momentMarketsAllowed } } : s,
        );
        break;
      case 'error':
        this.set({ lastError: { code: msg.code, message: msg.message } });
        break;
    }
  }
}

/** Build the engine WebSocket URL from an http(s) base. */
export function wsUrlFor(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  u.search = '';
  return u.toString();
}
