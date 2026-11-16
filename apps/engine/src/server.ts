import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import cors from '@fastify/cors';
import {
  PROTOCOL_VERSION,
  b58decode,
  clientMessageSchema,
  createPartySchema,
  joinChallengeMessage,
  verifyBytes,
  type ChainEvent,
  type ChainEventKind,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
  type Sport,
} from '@huddle/shared';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { ZodError } from 'zod';
import { EngineError } from './core/errors';
import { Engine } from './engine';
import { randomToken, safeEqual } from './keys';
import { ENGINE_VERSION, type EngineOptions } from './options';
import type { Conn, PartyRuntime } from './party';
import { defaultStaticDirs, registerStatic } from './static';

/**
 * HTTP + WebSocket front of the engine (PRD section 9). `startEngine` is what tests, bots, the demo
 * runner and the e2e suite call; `index.ts` is the process entrypoint.
 */

export interface EngineHandle {
  url: string;
  port: number;
  engine: Engine;
  close(): Promise<void>;
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  not_joined: 401,
  unauthorized: 401,
  not_found: 404,
  market_closed: 409,
  insufficient_funds: 400,
  stake_limit: 400,
  min_stake: 400,
  cosign_required: 409,
  rate_limited: 429,
  party_closed: 409,
  delay_restricted: 403,
  internal: 500,
};

const CHAIN_KINDS = new Set<ChainEventKind>(['create_party', 'deposit', 'request_close', 'submit_state', 'finalize', 'withdraw']);

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Normalize one QuickNode Streams record (our filter's output) into a ChainEvent. */
function toChainEvent(item: unknown): ChainEvent | null {
  if (!item || typeof item !== 'object') return null;
  const r = item as Record<string, unknown>;
  const signature = r.signature;
  const partyAddress = r.partyPda ?? r.partyAddress ?? r.party;
  const instruction = typeof r.instruction === 'string' ? r.instruction : typeof r.kind === 'string' ? r.kind : '';
  const kind = instruction
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .trim() as ChainEventKind;
  if (typeof signature !== 'string' || !signature || typeof partyAddress !== 'string' || !CHAIN_KINDS.has(kind)) return null;
  const ev: ChainEvent = { kind, signature, partyAddress, via: 'quicknode' };
  if (typeof r.slot === 'number') ev.slot = r.slot;
  if (typeof r.blockTime === 'number') ev.blockTime = r.blockTime;
  if (typeof r.member === 'string' && r.member) ev.member = r.member;
  const amount = typeof r.amount === 'string' ? Number(r.amount) : r.amount;
  if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0) ev.amount = amount;
  return ev;
}

function flattenStream(body: unknown): unknown[] {
  const root = body && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? (body as { data: unknown }).data : body;
  const out: unknown[] = [];
  const walk = (x: unknown, depth: number): void => {
    if (Array.isArray(x)) {
      if (depth < 4) for (const y of x) walk(y, depth + 1);
    } else if (x) out.push(x);
  };
  walk(root, 0);
  return out;
}

/**
 * Verify the Streams security token. Accepts QuickNode's HMAC headers
 * (x-qn-signature = HMAC-SHA256(token, nonce + timestamp + body)) or the token itself in a header.
 */
function verifyStreamToken(req: FastifyRequest, secret: string): boolean {
  const sig = header(req, 'x-qn-signature');
  if (sig) {
    const nonce = header(req, 'x-qn-nonce') ?? '';
    const ts = header(req, 'x-qn-timestamp') ?? '';
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    const expected = crypto.createHmac('sha256', secret).update(nonce + ts + raw).digest('hex');
    if (safeEqual(expected, sig.toLowerCase())) return true;
  }
  const auth = header(req, 'authorization');
  const candidates = [
    header(req, 'x-qn-token'),
    header(req, 'x-security-token'),
    header(req, 'x-huddle-token'),
    header(req, 'x-api-key'),
    auth?.startsWith('Bearer ') ? auth.slice(7) : undefined,
  ];
  return candidates.some((c) => typeof c === 'string' && c.length > 0 && safeEqual(c, secret));
}

export async function startEngine(options: EngineOptions = {}): Promise<EngineHandle> {
  const engine = new Engine(options);
  const { env, log, adapters } = engine;
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cors, { origin: true });

  // Keep the raw body: the Streams signature is computed over the exact bytes.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const raw = typeof body === 'string' ? body : '';
    (req as FastifyRequest & { rawBody?: string }).rawBody = raw;
    if (!raw.trim()) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(new EngineError('bad_request', 'Invalid JSON'));
    }
  });

  const fail = (reply: FastifyReply, code: ErrorCode, message: string): FastifyReply =>
    reply.code(HTTP_STATUS[code]).send({ error: { code, message } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof EngineError) return fail(reply, err.code, err.message);
    if (err instanceof ZodError) return fail(reply, 'bad_request', err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: { code: 'bad_request', message: (err as Error).message } });
    log.error({ err: (err as Error).message, stack: (err as Error).stack }, 'request failed');
    return fail(reply, 'internal', 'Something went wrong');
  });

  const partyOr404 = (code: string | undefined): PartyRuntime => {
    const rt = engine.party(code);
    if (!rt) throw new EngineError('not_found', 'No party with that code');
    return rt;
  };
  const requireHost = (req: FastifyRequest, rt: PartyRuntime): void => {
    if (!engine.verifyHostToken(rt, header(req, 'x-host-token'))) throw new EngineError('unauthorized', 'Host token required');
  };

  // ───────────────────────── REST ─────────────────────────

  app.get('/health', async () => ({
    ok: true,
    version: ENGINE_VERSION,
    settlement: engine.defaultSettlement,
    providers: {
      sports: adapters.sports.provider,
      gemini: adapters.gemini.source,
      announcer: adapters.announcer.provider,
      llm: adapters.llm.available ? (env.LLM_PROVIDER ?? 'anthropic') : 'mock',
    },
    parties: engine.activeParties().length,
  }));

  app.get('/games', async (req) => {
    const sport = (req.query as { sport?: string }).sport;
    const games = await adapters.sports.listGames(sport === 'soccer' || sport === 'nfl' ? (sport as Sport) : undefined);
    return { games };
  });

  app.post('/parties', async (req) => engine.createParty(createPartySchema.parse(req.body ?? {})));

  app.get('/parties', async () => ({ parties: engine.activeParties().map((rt) => rt.core.party) }));

  app.get('/parties/:code', async (req) => {
    const rt = partyOr404((req.params as { code: string }).code);
    return { party: rt.core.party, players: rt.core.players(), game: rt.game };
  });

  app.post('/parties/:code/close', async (req) => {
    const rt = partyOr404((req.params as { code: string }).code);
    requireHost(req, rt);
    void rt.endParty('host');
    return { ok: true, status: rt.status };
  });

  app.post('/replays/:id/start', async (req) => {
    const body = (req.body ?? {}) as { partyCode?: string; action?: string; positionMs?: number; speed?: number };
    const rt = partyOr404(body.partyCode);
    requireHost(req, rt);
    const gameId = (req.params as { id: string }).id;
    if (gameId !== rt.core.party.game.id) throw new EngineError('bad_request', 'That party is watching a different game');
    const action = body.action ?? 'start';
    if (action !== 'start' && action !== 'pause' && action !== 'seek' && action !== 'speed') {
      throw new EngineError('bad_request', 'action must be start, pause, seek or speed');
    }
    const args: { positionMs?: number; speed?: number } = {};
    if (action === 'seek') {
      if (typeof body.positionMs !== 'number' || body.positionMs < 0) throw new EngineError('bad_request', 'positionMs is required for seek');
      args.positionMs = Math.floor(body.positionMs);
    }
    if (action === 'speed') {
      if (typeof body.speed !== 'number' || body.speed < 0.25 || body.speed > 20) throw new EngineError('bad_request', 'speed must be between 0.25 and 20');
      args.speed = body.speed;
    }
    return { ok: true, status: rt.replay(action, args) };
  });

  app.post('/faucet', async (req) => {
    const body = (req.body ?? {}) as { wallet?: unknown; partyCode?: unknown };
    if (typeof body.wallet !== 'string') throw new EngineError('bad_request', 'wallet is required');
    const res = await engine.faucet(body.wallet, typeof body.partyCode === 'string' ? body.partyCode : undefined);
    return { ok: true, ...res };
  });

  app.post('/webhooks/quicknode', async (req, reply) => {
    const secret = env.QUICKNODE_STREAM_SECRET;
    if (!secret) return fail(reply, 'unauthorized', 'QUICKNODE_STREAM_SECRET is not configured');
    if (!verifyStreamToken(req, secret)) return fail(reply, 'unauthorized', 'Bad security token');
    const items = flattenStream(req.body);
    let handled = 0;
    for (const item of items) {
      const ev = toChainEvent(item);
      if (ev && engine.onChainEvent(ev)) handled++;
    }
    return { ok: true, received: items.length, handled };
  });

  app.get('/audio/:id', async (req, reply) => {
    const audio = adapters.announcer.getAudio((req.params as { id: string }).id);
    if (!audio) return fail(reply, 'not_found', 'No such audio');
    return reply.header('content-type', audio.mime).header('cache-control', 'public, max-age=3600').send(Buffer.from(audio.data));
  });

  app.get('/agent/session', async (req) => {
    const q = req.query as { party?: string; player?: string };
    const rt = partyOr404(q.party);
    const info = q.player ? rt.core.members.get(q.player) : undefined;
    if (q.player && (!info || info.isHouse)) throw new EngineError('not_found', 'That player is not in this party');
    const sessionToken = engine.issueSessionToken(rt.code, info?.pubkey ?? '');
    let agent = null;
    try {
      const params: { partyCode: string; playerName?: string; sessionToken: string } = { partyCode: rt.code, sessionToken };
      if (info) params.playerName = info.name;
      agent = (await adapters.announcer.agentSession?.(params)) ?? null;
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'agent session failed');
    }
    return { agent, sessionToken };
  });

  // ElevenLabs agent server tools: read-only, except `draft_bet`, which only ever creates a draft.
  app.post('/agent-tools/:tool', async (req, reply) => {
    const secret = env.AGENT_TOOLS_SECRET;
    if (!secret) return fail(reply, 'unauthorized', 'AGENT_TOOLS_SECRET is not configured');
    const given = header(req, 'x-huddle-secret');
    if (!given || !safeEqual(given, secret)) return fail(reply, 'unauthorized', 'Bad agent secret');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const session = engine.verifySessionToken(body.session_token);
    if (!session) return fail(reply, 'unauthorized', 'Bad or expired session token');
    const rt = engine.party(session.code);
    if (!rt) return fail(reply, 'not_found', 'That party is gone');
    const marketId = typeof body.market_id === 'string' ? body.market_id : '';
    try {
      switch ((req.params as { tool: string }).tool) {
        case 'get_party_state':
          return rt.toolPartyState();
        case 'get_market':
          return rt.toolMarket(marketId);
        case 'explain_odds':
          return rt.toolExplain(marketId);
        case 'draft_bet':
          return rt.toolDraftBet(
            session.player,
            typeof body.player === 'string' ? body.player : undefined,
            marketId,
            String(body.outcome ?? ''),
            Number(body.amount),
          );
        default:
          return fail(reply, 'not_found', 'Unknown tool');
      }
    } catch (e) {
      // Tool errors go back to the agent as data so it can explain them out loud.
      if (e instanceof EngineError) return { ok: false, error: e.message, code: e.code };
      throw e;
    }
  });

  registerStatic(app, engine, { ...defaultStaticDirs(), ...options.staticDirs });

  // ───────────────────────── listen ─────────────────────────

  const port = options.port ?? Number(env.PORT ?? 8080);
  await app.listen({ port, host: options.host ?? '0.0.0.0' });
  const actualPort = (app.server.address() as AddressInfo).port;
  const url = `http://localhost:${actualPort}`;
  engine.baseUrl = url;

  // ───────────────────────── WebSocket hub ─────────────────────────

  const wss = new WebSocketServer({ server: app.server, path: '/ws', maxPayload: 256 * 1024 });
  wss.on('connection', (ws: WsSocket) => {
    const challenge = randomToken(16);
    let conn: Conn | null = null;
    let party: PartyRuntime | null = null;

    const send = (msg: ServerMessage): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const ack = (id: string, data?: Record<string, unknown>): void => {
      const msg: ServerMessage = { type: 'ack', id, ok: true };
      if (data && Object.keys(data).length) msg.data = data;
      send(msg);
    };
    const nack = (id: string, code: ErrorCode, message: string): void => send({ type: 'ack', id, ok: false, error: { code, message } });

    const join = (msg: Extract<ClientMessage, { type: 'join' }>): void => {
      if (conn) return nack(msg.id, 'bad_request', 'Already joined');
      const rt = engine.party(msg.partyCode);
      if (!rt) return nack(msg.id, 'not_found', 'No party with that code');
      let pubkey: string | undefined;
      if (msg.role === 'player') {
        // Bind the session to the wallet: the client signs our random challenge (PRD section 13).
        if (!msg.playerPubkey || !msg.signature) return nack(msg.id, 'unauthorized', 'Players must sign the join challenge');
        try {
          if (b58decode(msg.playerPubkey).length !== 32) throw new Error('bad key');
        } catch {
          return nack(msg.id, 'bad_request', 'Invalid player key');
        }
        if (!verifyBytes(joinChallengeMessage(challenge, msg.partyCode), msg.signature, msg.playerPubkey)) {
          return nack(msg.id, 'unauthorized', 'Join signature does not match');
        }
        try {
          const opts: { name?: string; remote?: boolean; city?: string } = {};
          if (msg.name !== undefined) opts.name = msg.name;
          if (msg.remote !== undefined) opts.remote = msg.remote;
          if (msg.city !== undefined) opts.city = msg.city;
          rt.core.join(msg.playerPubkey, opts, engine.now());
        } catch (e) {
          if (e instanceof EngineError) return nack(msg.id, e.code, e.message);
          throw e;
        }
        pubkey = msg.playerPubkey;
      } else if (msg.role === 'box') {
        if (!engine.verifyHostToken(rt, msg.hostToken)) return nack(msg.id, 'unauthorized', 'Host token required');
      }
      const c: Conn = { id: randomToken(6), role: msg.role, send };
      if (pubkey) c.pubkey = pubkey;
      conn = c;
      party = rt;
      rt.attach(c);
      rt.flush();
      ack(msg.id);
      send({ type: 'party_state', ...rt.snapshot(c) });
      rt.resendUnsigned(c);
    };

    const onMessage = async (data: unknown): Promise<void> => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        return send({ type: 'error', code: 'bad_request', message: 'Invalid JSON' });
      }
      const rawId = (raw as { id?: unknown } | null)?.id;
      const id = typeof rawId === 'string' && rawId.length > 0 && rawId.length <= 64 ? rawId : null;
      const parsed = clientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'message'}: ${i.message}`).join('; ');
        return id ? nack(id, 'bad_request', message) : send({ type: 'error', code: 'bad_request', message });
      }
      const msg = parsed.data;
      if (msg.type === 'join') return join(msg);
      if (!conn || !party) {
        return msg.type === 'ping' ? ack(msg.id) : nack(msg.id, 'not_joined', 'Join a party first');
      }
      try {
        ack(msg.id, await party.handle(conn, msg));
      } catch (e) {
        if (e instanceof EngineError) return nack(msg.id, e.code, e.message);
        party.internalErrors++;
        log.error({ err: (e as Error).message, stack: (e as Error).stack, type: msg.type }, 'message handler failed');
        nack(msg.id, 'internal', 'Something went wrong');
      }
    };

    ws.on('message', (data) => {
      void onMessage(data).catch((e: unknown) => log.error({ err: (e as Error).message }, 'ws handler crashed'));
    });
    ws.on('close', () => {
      if (conn && party) party.detach(conn);
      conn = null;
    });
    ws.on('error', () => {
      /* close follows */
    });
    send({ type: 'hello', challenge, serverTime: new Date(engine.now()).toISOString(), version: PROTOCOL_VERSION });
  });

  await engine.restore();
  engine.start();
  log.info({ url, settlement: engine.defaultSettlement, sports: adapters.sports.provider }, 'huddle engine listening');

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await app.close();
      engine.close();
    })();
    return closing;
  };

  return { url, port: actualPort, engine, close };
}
