import crypto from 'node:crypto';
import path from 'node:path';
import { createAnnouncer, createLlmClient } from '@huddle/announcer';
import { createGeminiClient } from '@huddle/gemini';
import { createQuestionEngine, createQuestionRanker } from '@huddle/models';
import {
  BridgeClient,
  DEFAULT_PARTY_CONFIG,
  b58decode,
  randomId,
  toBase,
  type BoxBridge,
  type ChainEvent,
  type CreatePartyResponse,
  type GeminiPanel,
  type KeyPair,
  type Party,
  type PartyConfig,
  type SettlementClient,
  type SettlementMode,
} from '@huddle/shared';
import { createSettlementClient } from '@huddle/solana-client';
import { createSportsAdapter } from '@huddle/sports';
import pino, { type Logger } from 'pino';
import type { z } from 'zod';
import type { createPartySchema } from '@huddle/shared';
import { EngineError } from './core/errors';
import { PartyCore } from './core/party-core';
import { KeyStore, randomToken, safeEqual, sha256Hex } from './keys';
import { DEFAULT_TIMING, FAUCET_AMOUNT, type EngineAdapters, type EngineOptions, type EngineTiming, type Env } from './options';
import { PartyRuntime } from './party';
import { Store, type PersistedParty } from './store';

/**
 * The engine: owns the adapters, the store, the keys and every party. `server.ts` puts HTTP and
 * WebSocket in front of it; tests and the demo runner can also drive it directly.
 */

type CreatePartyInput = z.output<typeof createPartySchema>;

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easier to read off a TV
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

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

export function isSettlementMode(s: string | undefined): s is SettlementMode {
  return s === 'vault' || s === 'trusted' || s === 'points';
}

export class Engine {
  readonly parties = new Map<string, PartyRuntime>();
  readonly env: Env;
  readonly log: Logger;
  readonly store: Store;
  readonly keys: KeyStore;
  readonly adapters: EngineAdapters;
  readonly timing: EngineTiming;
  readonly boxSigner: KeyPair;
  readonly defaultSettlement: SettlementMode;
  readonly now: () => number;
  /** Base URL used in join links; set once the server is listening. */
  baseUrl = 'http://localhost:8080';

  private readonly byAddress = new Map<string, PartyRuntime>();
  private readonly settlements = new Map<SettlementMode, SettlementClient>();
  private readonly unsubs: (() => void)[] = [];
  private readonly faucetAt = new Map<string, number>();
  private readonly ownsBridge: boolean;
  private readonly sessionKey: Buffer;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private geminiTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly opts: EngineOptions = {}) {
    this.env = opts.env ?? process.env;
    this.now = opts.now ?? Date.now;
    this.log =
      opts.logger === false
        ? pino({ level: 'silent' })
        : (opts.logger ?? pino({ level: this.env.LOG_LEVEL ?? 'info', redact: ['secretKey', '*.secretKey', 'hostToken', '*.hostToken'] }));
    this.timing = { ...DEFAULT_TIMING, ...opts.timing, core: { ...DEFAULT_TIMING.core, ...opts.timing?.core } };

    const dataDir = opts.dataDir ?? this.env.DATA_DIR ?? './data';
    const onDisk = dataDir !== ':memory:';
    this.store = new Store(onDisk ? path.resolve(dataDir) : ':memory:');
    this.keys = new KeyStore(onDisk ? path.resolve(dataDir) : null);
    this.boxSigner = this.keys.boxSigner(this.env.BOX_SIGNER_SECRET_KEY);
    this.defaultSettlement = isSettlementMode(this.env.SETTLEMENT) ? this.env.SETTLEMENT : 'points';

    const a = opts.adapters ?? {};
    const llm = a.llm ?? createLlmClient(this.env);
    let bridge: BoxBridge | null;
    if (a.bridge !== undefined) {
      bridge = a.bridge;
      this.ownsBridge = false;
    } else {
      bridge = this.env.BRIDGE_URL ? new BridgeClient(this.env.BRIDGE_URL) : null;
      this.ownsBridge = true;
    }
    this.adapters = {
      sports: a.sports ?? createSportsAdapter(this.env),
      questionEngine: a.questionEngine ?? (() => createQuestionEngine()),
      llm,
      ranker: a.ranker ?? createQuestionRanker(llm),
      gemini: a.gemini ?? createGeminiClient(this.env),
      announcer: a.announcer ?? createAnnouncer(this.env, llm),
      settlement: a.settlement ?? ((mode) => createSettlementClient(mode, this.env)),
      bridge,
    };

    const tools = this.env.AGENT_TOOLS_SECRET;
    this.sessionKey = tools
      ? crypto.createHash('sha256').update(`huddle-session|${tools}`).digest()
      : Buffer.from(this.keys.sessionSecret());

    if (bridge) {
      this.unsubs.push(
        bridge.onEvent((e) => {
          // The box LOCK button locks the newest open moment market of the current party.
          if (e.type === 'button' && e.id === 'lock' && e.action === 'down') this.mostRecentActive()?.lockButton();
        }),
      );
    }
  }

  /** Start the timers. Call once after `restore()`. */
  start(): void {
    this.tickTimer = setInterval(() => {
      for (const rt of this.parties.values()) rt.tick();
    }, this.timing.tickMs);
    if (this.timing.geminiRefreshMs > 0) {
      this.geminiTimer = setInterval(() => {
        for (const rt of this.parties.values()) if (rt.status === 'live' || rt.status === 'lobby') rt.refreshGemini();
      }, this.timing.geminiRefreshMs);
      this.geminiTimer.unref?.();
    }
  }

  // ───────────────────────── settlement clients + chain events ─────────────────────────

  settlementFor(mode: SettlementMode): SettlementClient {
    let client = this.settlements.get(mode);
    if (!client) {
      client = this.adapters.settlement(mode);
      this.settlements.set(mode, client);
      try {
        this.unsubs.push(client.subscribe((e) => this.onChainEvent(e)));
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'could not subscribe to program events');
      }
    }
    return client;
  }

  /** Route a program event (Streams webhook, RPC logs, mock) to its party. Returns false if unknown. */
  onChainEvent(e: ChainEvent): boolean {
    const rt = this.byAddress.get(e.partyAddress);
    if (!rt) return false;
    try {
      rt.onChainEvent(e);
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'chain event failed');
    }
    return true;
  }

  // ───────────────────────── parties ─────────────────────────

  party(code: string | undefined): PartyRuntime | undefined {
    return code ? this.parties.get(code.trim().toUpperCase()) : undefined;
  }

  activeParties(): PartyRuntime[] {
    return [...this.parties.values()]
      .filter((rt) => rt.status !== 'finalized')
      .sort((a, b) => b.core.party.createdAt.localeCompare(a.core.party.createdAt));
  }

  mostRecentActive(): PartyRuntime | undefined {
    return this.activeParties()[0];
  }

  private register(rt: PartyRuntime): void {
    this.parties.set(rt.code, rt);
    this.byAddress.set(rt.core.party.chain.partyAddress, rt);
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
      if (!this.parties.has(code) && !this.store.codeExists(code)) return code;
    }
    throw new EngineError('internal', 'Could not allocate a party code');
  }

  verifyHostToken(rt: PartyRuntime, token: unknown): boolean {
    return typeof token === 'string' && token.length > 0 && safeEqual(sha256Hex(token), rt.hostTokenHash);
  }

  async createParty(input: CreatePartyInput): Promise<CreatePartyResponse> {
    const { sports, gemini, announcer, bridge } = this.adapters;
    const game = await sports.getGame(input.gameId);
    if (!game) throw new EngineError('not_found', 'Unknown game');

    const mode = input.settlement ?? this.defaultSettlement;
    const settlement = this.settlementFor(mode);
    const overrides = this.opts.partyDefaults ?? {};
    const defaults: PartyConfig = { ...DEFAULT_PARTY_CONFIG, ...overrides };
    const buyIn = toBase(input.buyIn);
    const houseBudget = toBase(input.houseBudget);
    const config: PartyConfig = {
      ...defaults,
      defaultMode: input.defaultMode,
      buyIn,
      maxBuyIn: Math.max(buyIn, overrides.maxBuyIn ?? buyIn * 5),
      houseBudget,
      houseBudgetPerMarket: Math.min(defaults.houseBudgetPerMarket, houseBudget),
      autoApprove: input.autoApprove ?? defaults.autoApprove,
      persona: input.persona ?? (game.sport === 'nfl' ? 'nfl' : 'soccer'),
      settlement: mode,
      // Trusted-host mode is the box-only-signature fallback (PRD section 8).
      requireMemberSig: input.requireMemberSig ?? (mode === 'trusted' ? false : defaults.requireMemberSig),
      // Points have no real challenge to wait for.
      challengeSecs: mode === 'points' ? Math.min(defaults.challengeSecs, 2) : defaults.challengeSecs,
    };

    const id = randomId(8);
    const code = this.newCode();
    const house = this.keys.createHouseKey(id);
    let created: { partyAddress: string; txSig?: string };
    try {
      created = await settlement.createParty({
        partyId: id,
        hostSecretKey: house.secretKey,
        boxSigner: this.boxSigner.publicKey,
        bond: config.bond,
        challengeSecs: this.timing.timeScale === 1 ? config.challengeSecs : config.challengeSecs / this.timing.timeScale,
        requireMemberSig: config.requireMemberSig,
      });
    } catch (e) {
      this.log.error({ err: (e as Error).message }, 'create_party failed');
      throw new EngineError('internal', `Could not create the party vault: ${(e as Error).message}`);
    }

    const publicUrl = (this.env.PUBLIC_ENGINE_URL ?? '').trim().replace(/\/+$/, '') || this.baseUrl;
    const party: Party = {
      id,
      code,
      name: input.name,
      hostPubkey: house.publicKey,
      boxSigner: this.boxSigner.publicKey,
      game,
      config,
      status: 'lobby',
      createdAt: new Date(this.now()).toISOString(),
      chain: { partyAddress: created.partyAddress },
      joinUrl: `${publicUrl}/j/${code}`,
    };
    if (created.txSig) party.chain.createTx = created.txSig;
    const sample = settlement.explorerUrl('SIGNATURE');
    if (sample?.includes('SIGNATURE')) party.chain.explorerBase = sample.split('SIGNATURE')[0]!;

    const hostToken = randomToken();
    const core = new PartyCore({ party, house, boxSecretKey: this.boxSigner.secretKey, timeScale: this.timing.timeScale, timing: this.timing.core });
    const rt = new PartyRuntime(core, this.depsFor(settlement, sha256Hex(hostToken)));
    this.register(rt);
    rt.flush();
    if (created.txSig) {
      rt.onChainEvent({ kind: 'create_party', signature: created.txSig, partyAddress: created.partyAddress, via: 'direct' });
    }

    // The house budget is a real deposit by the engine-held host key (D4).
    if (houseBudget > 0) {
      try {
        await settlement.faucet(house.publicKey, houseBudget);
        const dep = await settlement.depositFromKey({ partyAddress: created.partyAddress, secretKey: house.secretKey, amount: houseBudget });
        rt.confirmDeposit(house.publicKey, houseBudget, dep.txSig ?? `house:${id}`, 'direct');
      } catch (e) {
        this.log.warn({ party: code, err: (e as Error).message }, 'house deposit failed; Market mode will fall back to Pool');
      }
    }

    try {
      rt.feed = await sports.open(game.id, rt.onGameEvent);
    } catch (e) {
      this.log.error({ party: code, err: (e as Error).message }, 'could not open the sports feed');
    }

    const panel: GeminiPanel = (await withTimeout(gemini.matchGame(game), this.timing.setupTimeoutMs)) ?? {
      available: false,
      source: 'none',
      events: [],
      note: 'Gemini odds are unavailable right now',
    };
    rt.setGemini(panel);
    rt.calibrate();

    void announcer.warmup(config.persona).catch((e: unknown) => this.log.warn({ err: (e as Error).message }, 'announcer warmup failed'));
    try {
      bridge?.send({ type: 'nfc_set_url', url: party.joinUrl });
    } catch {
      /* the bridge is optional */
    }
    rt.led('idle');
    rt.flush();
    this.log.info({ party: code, game: game.id, settlement: settlement.label, mode: config.defaultMode }, 'party created');
    return { party: core.party, hostToken };
  }

  private depsFor(settlement: SettlementClient, hostTokenHash: string): ConstructorParameters<typeof PartyRuntime>[1] {
    return {
      adapters: this.adapters,
      timing: this.timing,
      store: this.store,
      log: this.log,
      now: this.now,
      boxSecretKey: this.boxSigner.secretKey,
      settlement,
      hostTokenHash,
    };
  }

  /** Reload parties after a restart: balances, nonces, signatures, markets and the paused feed. */
  async restore(): Promise<void> {
    let persisted: PersistedParty[];
    try {
      persisted = this.store.loadAll(this.now() - 48 * 60 * 60 * 1000);
    } catch (e) {
      this.log.error({ err: (e as Error).message }, 'could not load stored parties');
      return;
    }
    for (const p of persisted) {
      const code = p.party.code;
      try {
        if (p.party.boxSigner !== this.boxSigner.publicKey) {
          this.log.error({ party: code }, 'stored party was signed by a different box key; not restoring it');
          continue;
        }
        const house = this.keys.houseKey(p.party.id);
        if (!house || house.publicKey !== p.party.hostPubkey) {
          this.log.error({ party: code }, 'house key for stored party is missing; not restoring it');
          continue;
        }
        const core = new PartyCore({
          party: p.party,
          house,
          boxSecretKey: this.boxSigner.secretKey,
          timeScale: this.timing.timeScale,
          timing: this.timing.core,
        });
        core.hydrate(p.core);
        const settlement = this.settlementFor(p.party.config.settlement);
        const rt = new PartyRuntime(core, this.depsFor(settlement, p.hostTokenHash), p.runtime);
        this.register(rt);
        if (p.party.status !== 'finalized') {
          try {
            rt.feed = await this.adapters.sports.open(p.party.game.id, rt.onGameEvent);
            const control = rt.feed.control;
            if (control) {
              // Reopen paused where the game was; the host presses play to continue.
              control.pause();
              control.setSpeed(p.runtime.speed || 1);
              control.seek(p.runtime.positionMs);
            }
          } catch (e) {
            this.log.warn({ party: code, err: (e as Error).message }, 'could not reopen the sports feed');
          }
          rt.calibrate();
        }
        this.log.info({ party: code, status: p.party.status, members: core.members.size, markets: core.markets.size }, 'party restored');
        if (p.party.status === 'ended' || p.party.status === 'closing') void rt.endParty('resume');
      } catch (e) {
        this.log.error({ party: code, err: (e as Error).message }, 'could not restore party');
      }
    }
  }

  // ───────────────────────── faucet ─────────────────────────

  /** 25 test USDC to a new player, rate-limited per wallet (devnet / points only). */
  async faucet(wallet: string, partyCode?: string): Promise<{ txSig?: string; amount: number }> {
    try {
      if (b58decode(wallet).length !== 32) throw new Error('bad length');
    } catch {
      throw new EngineError('bad_request', 'Invalid wallet address');
    }
    const last = this.faucetAt.get(wallet);
    if (last !== undefined && Date.now() - last < this.timing.faucetCooldownMs) {
      throw new EngineError('rate_limited', 'This wallet was topped up a moment ago');
    }
    this.faucetAt.set(wallet, Date.now());
    const rt = this.party(partyCode) ?? this.mostRecentActive();
    const client = rt?.settlement ?? this.settlementFor(this.defaultSettlement);
    try {
      const res = await client.faucet(wallet, FAUCET_AMOUNT);
      const out: { txSig?: string; amount: number } = { amount: FAUCET_AMOUNT };
      if (res.txSig) out.txSig = res.txSig;
      return out;
    } catch (e) {
      this.faucetAt.delete(wallet);
      throw new EngineError('internal', `Faucet failed: ${(e as Error).message}`);
    }
  }

  // ───────────────────────── agent session tokens ─────────────────────────

  private sign(payload: string): string {
    return crypto.createHmac('sha256', this.sessionKey).update(payload).digest('hex');
  }

  /** HMAC of party code + player + expiry, passed to the ElevenLabs agent as a dynamic variable. */
  issueSessionToken(code: string, player = '', ttlMs = SESSION_TTL_MS): string {
    const payload = `${code}|${player}|${Date.now() + ttlMs}`;
    return `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`;
  }

  verifySessionToken(token: unknown): { code: string; player?: string } | null {
    if (typeof token !== 'string') return null;
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    let payload: string;
    try {
      payload = Buffer.from(body, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    if (!safeEqual(this.sign(payload), mac)) return null;
    const [code, player, exp] = payload.split('|');
    if (!code || !exp || Number(exp) < Date.now()) return null;
    const out: { code: string; player?: string } = { code };
    if (player) out.player = player;
    return out;
  }

  // ───────────────────────── shutdown ─────────────────────────

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.geminiTimer) clearInterval(this.geminiTimer);
    for (const u of this.unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    for (const rt of this.parties.values()) {
      try {
        rt.markDirty();
        rt.flush();
      } catch {
        /* best effort */
      }
      rt.dispose();
    }
    if (this.ownsBridge) this.adapters.bridge?.close();
    this.store.close();
  }
}
