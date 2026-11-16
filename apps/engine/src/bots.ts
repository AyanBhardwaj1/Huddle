import {
  HuddleClient,
  RequestError,
  defaultOddsForPrior,
  generateKeyPair,
  quoteBuySpend,
  remainingTakerCapacity,
  roundOdds,
  wsUrlFor,
  type ClientRequest,
  type KeyPair,
  type Market,
  type PartySnapshot,
} from '@huddle/shared';

/**
 * Bot players (PRD section 14, A2 "done when"): N players that join with the same `HuddleClient` the
 * real apps use, buy in, and then bet and trade randomly but validly in whatever mode each market
 * has: pool stakes, AMM buys and cash-outs, head-to-head offers, takes and cancels. They countersign
 * every balance automatically and stay connected until the party is paid out.
 */

export interface BotsOptions {
  /** Engine base URL, e.g. http://localhost:8080. */
  url: string;
  partyCode: string;
  n: number;
  /** Buy-in in base units. Default: the party's buy-in. */
  buyIn?: number;
  /** Average real ms between one bot's actions (default 1500). */
  intervalMs?: number;
  names?: string[];
  /** Seed for reproducible runs. */
  seed?: number;
  /** Ask the engine faucet for test funds before buying in (default: only when the party is not points). */
  faucet?: boolean;
  log?: (line: string) => void;
  WebSocketCtor?: typeof WebSocket;
}

export interface BotStats {
  actions: number;
  accepted: number;
  /** Rejections by error code (a market locking mid-request is normal). */
  rejected: Record<string, number>;
  /** Accepted actions by kind. */
  byKind: Record<string, number>;
}

export interface Bot {
  name: string;
  keyPair: KeyPair;
  client: HuddleClient;
}

export interface BotsHandle {
  bots: Bot[];
  stats: BotStats;
  /** Stop trading; bots stay connected so they keep countersigning. */
  stop(): void;
  /** Disconnect everyone. */
  close(): void;
  /** Resolves when every bot has seen the party finalized (or after `close`). */
  done: Promise<void>;
}

const NAMES = ['Ayan', 'Jake', 'Priya', 'Mateo', 'Zoe', 'Kenji', 'Lena', 'Omar', 'Tess', 'Ravi', 'Mia', 'Dev'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Action = { kind: string; request: ClientRequest };

/** Decide one valid action for a bot from its own view of the party. Null = nothing sensible to do. */
export function chooseAction(snap: PartySnapshot, me: string, rnd: () => number): Action | null {
  const you = snap.you;
  if (!you || (snap.party.status !== 'lobby' && snap.party.status !== 'live')) return null;
  const cfg = snap.party.config;
  const balance = you.state?.balance ?? 0;
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const open = snap.markets.filter((m) => m.state === 'open' && (m.kind !== 'moment' || you.momentMarketsAllowed));
  if (open.length === 0) return null;
  const m: Market = pick(open);
  // Leave a little time before a countdown lock so requests do not race it.
  if (m.lock.at && Date.parse(m.lock.at) - Date.parse(snap.serverTime) < 0) return null;

  const positions = you.positions.filter((p) => p.marketId === m.id);
  const myOffers = snap.offers.filter((o) => o.marketId === m.id && o.open && o.maker === me);
  const atRisk = positions.reduce((a, p) => a + p.stake, 0) + myOffers.reduce((a, o) => a + (o.makerStake - o.filled), 0);
  // Same rule as the engine: total in one market <= maxStakeFraction * (balance + already in it).
  const room = Math.min(balance, Math.floor(cfg.maxStakeFraction * (balance + atRisk)) - atRisk);
  const canStake = room >= cfg.minStake;
  const stake = (): number => {
    const hi = Math.max(cfg.minStake, Math.floor(room * 0.6));
    return Math.max(cfg.minStake, Math.min(hi, cfg.minStake + Math.floor(rnd() * (hi - cfg.minStake + 1))));
  };
  const outcome = pick(m.outcomes).id;
  const r = rnd();

  if (m.mode === 'pool') {
    if (!canStake) return null;
    return { kind: 'pool_bet', request: { type: 'place_bet', marketId: m.id, outcome, stake: stake() } };
  }

  if (m.mode === 'amm') {
    const held = positions.filter((p) => p.shares && Number(p.shares) > 0);
    if (held.length > 0 && (r < 0.25 || !canStake)) {
      const p = pick(held);
      // Cash out everything, or half.
      const half = (Math.floor(Number(p.shares) * 500_000) / 1_000_000).toFixed(6);
      const shares = rnd() < 0.5 || Number(half) <= 0 ? ('all' as const) : half;
      return { kind: 'amm_sell', request: { type: 'amm_trade', marketId: m.id, outcome: p.outcome, side: 'sell', shares } };
    }
    if (!canStake) return null;
    const spend = stake();
    if (r < 0.55) return { kind: 'amm_bet', request: { type: 'place_bet', marketId: m.id, outcome, stake: spend } };
    if (r < 0.8 || !m.q || !m.ammB) {
      return { kind: 'amm_buy_spend', request: { type: 'amm_trade', marketId: m.id, outcome, side: 'buy', spend } };
    }
    const target = Math.floor(spend * 0.8);
    if (target < cfg.minStake * 1.1) {
      return { kind: 'amm_buy_spend', request: { type: 'amm_trade', marketId: m.id, outcome, side: 'buy', spend } };
    }
    try {
      // Buy by share count: quote locally with the shared math, leaving headroom for price moves.
      const quote = quoteBuySpend(m.q, m.ammB, outcome, target);
      return { kind: 'amm_buy_shares', request: { type: 'amm_trade', marketId: m.id, outcome, side: 'buy', shares: quote.shares } };
    } catch {
      return { kind: 'amm_buy_spend', request: { type: 'amm_trade', marketId: m.id, outcome, side: 'buy', spend } };
    }
  }

  // Bet mode (head-to-head).
  const takeable = snap.offers.filter((o) => o.marketId === m.id && o.open && o.maker !== me);
  if (myOffers.length > 0 && r < 0.1) {
    return { kind: 'cancel_offer', request: { type: 'cancel_offer', offerId: pick(myOffers).id } };
  }
  if (!canStake) return null;
  if (takeable.length > 0 && r < 0.5) {
    const offer = pick(takeable);
    // The engine charges min(amount, what is left of the offer), so this never exceeds our room.
    const amount = rnd() < 0.3 ? Math.max(cfg.minStake, Math.min(room, remainingTakerCapacity(offer))) : stake();
    return { kind: 'take_offer', request: { type: 'take_offer', offerId: offer.id, amount } };
  }
  if (r < 0.75) return { kind: 'bet_one_tap', request: { type: 'place_bet', marketId: m.id, outcome, stake: stake() } };
  const fair = defaultOddsForPrior(m.prior[outcome] ?? 0.5);
  const odds = roundOdds(Math.min(20, Math.max(1.05, fair * (0.85 + rnd() * 0.3))));
  return { kind: 'post_offer', request: { type: 'post_offer', marketId: m.id, side: outcome, makerStake: stake(), odds } };
}

export async function runBots(opts: BotsOptions): Promise<BotsHandle> {
  const rnd = mulberry32(opts.seed ?? Date.now());
  const log = opts.log ?? ((): void => undefined);
  const interval = opts.intervalMs ?? 1500;
  const stats: BotStats = { actions: 0, accepted: 0, rejected: {}, byKind: {} };
  const bots: Bot[] = [];
  let trading = true;
  let closed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const checkDone = (): void => {
    if (bots.length === opts.n && bots.every((b) => b.client.getView().snapshot?.party.status === 'finalized')) resolveDone();
  };

  const act = async (bot: Bot): Promise<void> => {
    const snap = bot.client.getView().snapshot;
    if (!snap) return;
    const action = chooseAction(snap, bot.keyPair.publicKey, rnd);
    if (!action) return;
    stats.actions++;
    try {
      await bot.client.request(action.request);
      stats.accepted++;
      stats.byKind[action.kind] = (stats.byKind[action.kind] ?? 0) + 1;
    } catch (e) {
      const code = e instanceof RequestError ? e.code : 'network';
      stats.rejected[code] = (stats.rejected[code] ?? 0) + 1;
      log(`${bot.name}: ${action.kind} rejected (${code}: ${(e as Error).message})`);
    }
  };

  const loop = (bot: Bot): void => {
    if (closed || !trading) return;
    const t = setTimeout(
      () => {
        timers.delete(t);
        const status = bot.client.getView().snapshot?.party.status;
        if (closed || !trading || (status && status !== 'lobby' && status !== 'live')) return;
        void act(bot).finally(() => loop(bot));
      },
      interval * (0.5 + rnd()),
    );
    timers.add(t);
  };

  const wsUrl = wsUrlFor(opts.url);
  for (let i = 0; i < opts.n; i++) {
    const keyPair = generateKeyPair();
    const name = opts.names?.[i] ?? `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''} (bot)`;
    const clientOpts: ConstructorParameters<typeof HuddleClient>[0] = { url: wsUrl, partyCode: opts.partyCode, role: 'player', keyPair, name };
    if (opts.WebSocketCtor) clientOpts.WebSocketCtor = opts.WebSocketCtor;
    const client = new HuddleClient(clientOpts);
    const bot: Bot = { name, keyPair, client };
    client.subscribe(checkDone);
    client.connect();
    bots.push(bot);
  }

  await Promise.all(
    bots.map(async (bot) => {
      const snap = await bot.client.ready();
      const wantFaucet = opts.faucet ?? snap.party.config.settlement !== 'points';
      if (wantFaucet) {
        try {
          await fetch(`${opts.url.replace(/\/+$/, '')}/faucet`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ wallet: bot.keyPair.publicKey, partyCode: opts.partyCode }),
          });
        } catch {
          /* the buy-in will say if funds are missing */
        }
      }
      const already = snap.players.find((p) => p.pubkey === bot.keyPair.publicKey)?.deposited ?? 0;
      if (already === 0) await bot.client.buyIn(opts.buyIn ?? snap.party.config.buyIn);
      log(`${bot.name} joined and bought in`);
    }),
  );
  for (const bot of bots) loop(bot);
  checkDone();

  return {
    bots,
    stats,
    stop(): void {
      trading = false;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
    close(): void {
      closed = true;
      trading = false;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const b of bots) b.client.close();
      resolveDone();
    },
    done,
  };
}
