import {
  HuddleClient,
  generateKeyPair,
  keyPairFromSecret,
  verifyBytes,
  wsUrlFor,
  type Announcer,
  type AnnouncerEvent,
  type AnnouncerLine,
  type BalanceState,
  type CreatePartyRequest,
  type CreatePartyResponse,
  type DepositRequest,
  type HostAction,
  type KeyPair,
  type Persona,
  type RoomContext,
  type ServerMessage,
  type SettlementClient,
  type SettlementMode,
  type TalkContext,
  type TalkReply,
} from '@huddle/shared';
import {
  MockAnnouncer,
  MockBoxBridge,
  MockGeminiClient,
  MockLlmClient,
  MockQuestionEngine,
  MockSettlementClient,
  MockSportsAdapter,
  TemplateRanker,
} from '@huddle/shared/mocks';
import type { EngineOptions } from './options';
import type { PartyRuntime } from './party';
import { startEngine, type EngineHandle } from './server';

/**
 * In-process engine with every adapter mocked and time compressed, for the integration tests.
 * (Not used by the engine itself.)
 */

/** Records what the engine asked the announcer to say; serves fake audio for one line. */
export class RecordingAnnouncer implements Announcer {
  readonly provider = 'mock' as const;
  readonly events: AnnouncerEvent[] = [];
  readonly questions: string[] = [];
  private readonly inner = new MockAnnouncer();
  /** Artificial latency, to prove the announcer never blocks the bet path. */
  delayMs = 0;

  warmup(persona: Persona): Promise<void> {
    return this.inner.warmup(persona);
  }
  async announce(event: AnnouncerEvent, ctx: RoomContext): Promise<AnnouncerLine | null> {
    this.events.push(event);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const line = await this.inner.announce(event, ctx);
    if (line && event.type === 'game_recap') line.audioUrl = `/audio/${line.id}`;
    if (line?.audioUrl) this.audio.set(line.id, new Uint8Array([1, 2, 3, 4]));
    return line;
  }
  private readonly audio = new Map<string, Uint8Array>();
  getAudio(id: string): { mime: string; data: Uint8Array } | undefined {
    const data = this.audio.get(id);
    return data ? { mime: 'audio/mpeg', data } : undefined;
  }
  async answer(text: string, ctx: TalkContext): Promise<TalkReply> {
    this.questions.push(text);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return this.inner.answer(text, ctx);
  }
  types(): string[] {
    return this.events.map((e) => e.type);
  }
}

/**
 * A mock vault whose deposits must be signed by the member, like the real one (D8): exercises the
 * `buy_in` -> `buy_in_sign` round trip without a chain.
 */
export class SigningSettlement extends MockSettlementClient {
  private readonly awaiting = new Map<string, { member: string; message: Uint8Array }>();

  override async prepareDeposit(params: { partyAddress: string; member: string; amount: number }): Promise<DepositRequest> {
    const req = await super.prepareDeposit(params);
    const message = new TextEncoder().encode(`huddle-deposit|${req.depositId}|${params.member}|${params.amount}`);
    this.awaiting.set(req.depositId, { member: params.member, message });
    return { depositId: req.depositId, messageB64: Buffer.from(message).toString('base64') };
  }

  override async submitDeposit(params: { depositId: string; memberSignatureB64?: string }): Promise<{ txSig?: string; amount: number }> {
    const w = this.awaiting.get(params.depositId);
    if (w) {
      if (!params.memberSignatureB64 || !verifyBytes(w.message, params.memberSignatureB64, w.member)) {
        throw new Error('deposit transaction is not signed by the member');
      }
      this.awaiting.delete(params.depositId);
    }
    return super.submitDeposit({ depositId: params.depositId });
  }

  override async depositFromKey(params: { partyAddress: string; secretKey: Uint8Array; amount: number }): Promise<{ txSig?: string }> {
    // The engine holds this key, so it "signs" directly.
    const req = await super.prepareDeposit({ partyAddress: params.partyAddress, member: memberOf(params.secretKey), amount: params.amount });
    return super.submitDeposit({ depositId: req.depositId });
  }
}

function memberOf(secretKey: Uint8Array): string {
  return keyPairFromSecret(secretKey).publicKey;
}

export interface TestPlayer {
  client: HuddleClient;
  keyPair: KeyPair;
  pubkey: string;
  name: string;
  messages: ServerMessage[];
  balance(): number;
}

export interface Harness {
  handle: EngineHandle;
  url: string;
  bridge: MockBoxBridge;
  announcer: RecordingAnnouncer;
  settlements: Map<SettlementMode, SettlementClient>;
  createParty(body?: Partial<CreatePartyRequest>): Promise<CreatePartyResponse & { rt: PartyRuntime }>;
  box(code: string, hostToken: string): Promise<HuddleClient>;
  host(box: HuddleClient, action: HostAction): Promise<Record<string, unknown>>;
  player(
    code: string,
    name: string,
    opts?: { buyIn?: number; keyPair?: KeyPair; autoCosign?: boolean; lastSigned?: BalanceState | null; remote?: boolean },
  ): Promise<TestPlayer>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }>;
  get(path: string, headers?: Record<string, string>): Promise<{ status: number; json: Record<string, unknown>; text: string; headers: Headers }>;
  close(): Promise<void>;
}

export const TEST_ENV = { QUICKNODE_STREAM_SECRET: 'qn-test-secret', AGENT_TOOLS_SECRET: 'agent-test-secret' };

export async function startTestEngine(over: Partial<EngineOptions> = {}, makeSettlement?: (mode: SettlementMode) => SettlementClient): Promise<Harness> {
  const bridge = new MockBoxBridge();
  const announcer = new RecordingAnnouncer();
  const settlements = new Map<SettlementMode, SettlementClient>();
  const handle = await startEngine({
    port: 0,
    host: '127.0.0.1',
    dataDir: ':memory:',
    logger: false,
    env: TEST_ENV,
    ...over,
    adapters: {
      sports: new MockSportsAdapter(),
      questionEngine: () => new MockQuestionEngine(),
      ranker: new TemplateRanker(),
      gemini: new MockGeminiClient(),
      llm: new MockLlmClient(),
      announcer,
      settlement: (mode) => {
        const client = makeSettlement?.(mode) ?? new MockSettlementClient(mode);
        settlements.set(mode, client);
        return client;
      },
      bridge,
      ...over.adapters,
    },
    // 20x: a 20 s dispute window is 1 s, the one-minute mock match takes 3 s at replay speed 20.
    timing: { timeScale: 20, tickMs: 15, geminiRefreshMs: 0, faucetCooldownMs: 60_000, ...over.timing },
  });
  const url = handle.url;
  const clients: HuddleClient[] = [];

  const post: Harness['post'] = async (path, body, headers = {}) => {
    const res = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const get: Harness['get'] = async (path, headers = {}) => {
    const res = await fetch(url + path, { headers, redirect: 'manual' });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  };

  return {
    handle,
    url,
    bridge,
    announcer,
    settlements,
    post,
    get,
    async createParty(body = {}) {
      const res = await post('/parties', { gameId: 'mock-soccer', name: 'Test party', ...body });
      if (res.status !== 200) throw new Error(`create party failed: ${JSON.stringify(res.json)}`);
      const out = res.json as unknown as CreatePartyResponse;
      return { ...out, rt: handle.engine.party(out.party.code)! };
    },
    async box(code, hostToken) {
      const client = new HuddleClient({ url: wsUrlFor(url), partyCode: code, role: 'box', hostToken, reconnect: false });
      clients.push(client);
      client.connect();
      await client.ready();
      return client;
    },
    host(box, action) {
      return box.request({ type: 'host_action', action });
    },
    async player(code, name, opts = {}) {
      const keyPair = opts.keyPair ?? generateKeyPair();
      const messages: ServerMessage[] = [];
      const clientOpts: ConstructorParameters<typeof HuddleClient>[0] = {
        url: wsUrlFor(url),
        partyCode: code,
        role: 'player',
        keyPair,
        name,
        reconnect: false,
        onMessage: (m) => messages.push(m),
      };
      if (opts.autoCosign !== undefined) clientOpts.autoCosign = opts.autoCosign;
      if (opts.lastSigned !== undefined) clientOpts.lastSigned = opts.lastSigned;
      if (opts.remote !== undefined) clientOpts.remote = opts.remote;
      const client = new HuddleClient(clientOpts);
      clients.push(client);
      client.connect();
      await client.ready();
      if (opts.buyIn) await client.buyIn(opts.buyIn);
      return {
        client,
        keyPair,
        pubkey: keyPair.publicKey,
        name,
        messages,
        balance: () => client.getView().snapshot?.you?.state?.balance ?? 0,
      };
    },
    async close() {
      for (const c of clients) c.close();
      await handle.close();
    },
  };
}

export async function waitUntil(pred: () => boolean, timeoutMs = 10_000, what = 'condition'): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
