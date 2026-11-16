/**
 * `?fixture=1` mode: a realistic static party so the player UI can be reviewed and screenshotted with
 * no engine. `?fixture=end` shows the end-of-game screen, `?fixture=buyin` the buy-in screen.
 * Requests are simulated just enough for taps to feel real. Isolated here on purpose.
 */
import {
  DEFAULT_PARTY_CONFIG,
  lmsrInitQ,
  lmsrLiquidity,
  lmsrPrices,
  quoteBuySpend,
  USDC,
  type AnnouncerLine,
  type BetOffer,
  type ClientRequest,
  type ClientView,
  type Market,
  type PartySnapshot,
  type PlayerPublic,
  type Position,
} from '@huddle/shared';
import type { PartyClient } from './lib/session';

const ME = 'You1111111111111111111111111111111111111111';
const iso = (ms: number) => new Date(ms).toISOString();

function player(pubkey: string, name: string, deposited: number, balance: number, locked: number, extra: Partial<PlayerPublic> = {}): PlayerPublic {
  return {
    pubkey,
    name,
    isHouse: false,
    remote: false,
    connected: true,
    deposited,
    balance,
    locked,
    pnl: balance + locked - deposited,
    joinedAt: iso(Date.now() - 40 * 60_000),
    ...extra,
  };
}

function build(variant: string): PartySnapshot {
  const now = Date.now();
  const base = { partyId: 'party-demo', resolver: { type: 'manual', params: {} }, createdBy: 'ai' as const, createdAt: iso(now - 60_000) };
  const yn = [
    { id: 'yes', label: 'YES' },
    { id: 'no', label: 'NO' },
  ];

  const ammPrior = { por: 0.58, esp: 0.42 };
  const b = lmsrLiquidity(2 * USDC, ammPrior);
  const q0 = lmsrInitQ(ammPrior, b);
  const q = { ...q0, por: String(Number(q0.por) + 3.2), esp: String(Number(q0.esp) + 1.1) };

  const markets: Market[] = [
    {
      ...base,
      id: 'm-pen',
      question: 'Will Ronaldo score this penalty?',
      kind: 'moment',
      mode: 'pool',
      outcomes: yn,
      prior: { yes: 0.77, no: 0.23 },
      geminiRef: { eventTicker: 'POR-ESP', contractTicker: 'PEN', prob: 0.74, asOf: iso(now - 90_000), outcomeId: 'yes' },
      pool: { yes: 14 * USDC, no: 6 * USDC },
      price: { yes: 0.7, no: 0.3 },
      lock: { manual: true, at: iso(now + 45_000) },
      openedAt: iso(now - 5_000),
      state: 'open',
      volume: 20 * USDC,
      hook: 'Penalty to Portugal!',
    },
    {
      ...base,
      id: 'm-corner',
      question: 'Corner leads to a shot on target?',
      kind: 'moment',
      mode: 'bet',
      outcomes: yn,
      prior: { yes: 0.35, no: 0.65 },
      price: { yes: 0.38, no: 0.62 },
      lock: { manual: true, at: iso(now + 75_000) },
      openedAt: iso(now - 10_000),
      state: 'open',
      volume: 8 * USDC,
    },
    {
      ...base,
      id: 'm-winner',
      question: 'Who wins the match?',
      kind: 'game',
      mode: 'amm',
      outcomes: [
        { id: 'por', label: 'Portugal' },
        { id: 'esp', label: 'Spain' },
      ],
      prior: ammPrior,
      ammB: b,
      q,
      price: lmsrPrices(q, b),
      geminiRef: { eventTicker: 'POR-ESP', contractTicker: 'POR', prob: 0.61, asOf: iso(now - 120_000), outcomeId: 'por' },
      lock: { manual: true, at: iso(now + 38 * 60_000) },
      openedAt: iso(now - 50 * 60_000),
      state: 'open',
      volume: 31 * USDC,
    },
    {
      ...base,
      id: 'm-goals',
      question: 'Total goals: 3 or more?',
      kind: 'game',
      mode: 'pool',
      outcomes: yn,
      prior: { yes: 0.44, no: 0.56 },
      pool: { yes: 9 * USDC, no: 12 * USDC },
      price: { yes: 0.43, no: 0.57 },
      lock: { manual: true, at: iso(now + 30 * 60_000) },
      state: 'open',
      volume: 21 * USDC,
    },
    {
      ...base,
      id: 'm-card',
      question: 'Yellow card before the 60th minute?',
      kind: 'moment',
      mode: 'pool',
      outcomes: yn,
      prior: { yes: 0.5, no: 0.5 },
      pool: { yes: 5 * USDC, no: 3 * USDC },
      price: { yes: 0.62, no: 0.38 },
      lock: { manual: true, at: iso(now - 30_000) },
      state: 'resolved',
      outcome: 'yes',
      resolvedAt: iso(now - 4_000),
      disputeEndsAt: iso(now + 16_000),
      volume: 8 * USDC,
    },
    {
      ...base,
      id: 'm-free',
      question: 'Free kick ends in a goal?',
      kind: 'moment',
      mode: 'amm',
      outcomes: yn,
      prior: { yes: 0.08, no: 0.92 },
      price: { yes: 0.1, no: 0.9 },
      lock: { manual: true },
      state: 'voided',
      voidReason: 'feed glitch',
      resolvedAt: iso(now - 300_000),
      volume: 3 * USDC,
    },
  ];

  const offers: BetOffer[] = [
    { id: 'o1', marketId: 'm-corner', maker: 'JAKE', makerName: 'Jake', side: 'no', makerStake: 5 * USDC, odds: 1.4, filled: 0, open: true, createdAt: iso(now - 8_000) },
    { id: 'o2', marketId: 'm-corner', maker: 'PRIYA', makerName: 'Priya', side: 'yes', makerStake: 2 * USDC, odds: 3.2, filled: 0, open: true, createdAt: iso(now - 6_000) },
    { id: 'o3', marketId: 'm-corner', maker: ME, makerName: 'You', side: 'yes', makerStake: 3 * USDC, odds: 2.6, filled: USDC, open: true, createdAt: iso(now - 4_000) },
  ];

  const positions: Position[] = [
    { partyId: 'party-demo', marketId: 'm-pen', player: ME, outcome: 'yes', stake: 2 * USDC, potential: Math.floor((2 * 20) / 14 * USDC) },
    { partyId: 'party-demo', marketId: 'm-winner', player: ME, outcome: 'por', shares: '6.500000', stake: 3.6 * USDC, potential: 6.5 * USDC },
    { partyId: 'party-demo', marketId: 'm-card', player: ME, outcome: 'yes', stake: 1 * USDC, potential: 1.6 * USDC },
  ];

  const players: PlayerPublic[] = [
    player('AYAN', 'Ayan', 10 * USDC, 17.4 * USDC, 2 * USDC, { streak: 3 }),
    player(ME, 'You', 10 * USDC, 4.6 * USDC, 6.6 * USDC, { streak: 1 }),
    player('PRIYA', 'Priya', 10 * USDC, 7 * USDC, 3.5 * USDC, { remote: true }),
    player('JAKE', 'Jake', 20 * USDC, 9.2 * USDC, 5 * USDC, { streak: -2 }),
    player('HOUSE', 'House', 20 * USDC, 18 * USDC, 2 * USDC, { isHouse: true }),
  ];

  const announcer: AnnouncerLine[] = [
    { id: 'a1', text: "Penalty to Portugal! Ronaldo steps up. Room's got him at 70%. Get in!", priority: 'high', createdAt: iso(now - 4_000), event: 'market_opened', marketId: 'm-pen', persona: 'soccer' },
  ];

  const ended = variant === 'end';
  if (ended) {
    for (const m of markets) if (m.state === 'open') Object.assign(m, { state: 'final', outcome: m.outcomes[0]!.id, resolvedAt: iso(now - 60_000) });
    players.forEach((p) => {
      p.balance += p.locked;
      p.locked = 0;
      p.payout = p.balance;
    });
    players[1]!.withdrawTx = '5xDemoPayoutSignature';
  }

  return {
    party: {
      id: 'party-demo',
      code: 'DEMO',
      name: "Ayan's watch party",
      hostPubkey: 'AYAN',
      boxSigner: 'BOX',
      game: {
        id: 'g1',
        sport: 'soccer',
        title: 'Portugal vs Spain',
        home: { name: 'Portugal', short: 'POR', color: '#E4002B' },
        away: { name: 'Spain', short: 'ESP', color: '#F1BF00' },
        status: 'replay',
        source: 'replay',
      },
      config: { ...DEFAULT_PARTY_CONFIG, settlement: 'vault' },
      status: ended ? 'finalized' : 'live',
      createdAt: iso(now - 50 * 60_000),
      chain: { partyAddress: 'PartyDemo11111111111111111111111111111111', explorerBase: 'https://explorer.solana.com', finalizeTx: ended ? '4xDemoFinalize' : undefined },
      joinUrl: '/j/DEMO',
    },
    players,
    markets,
    offers,
    fills: [],
    game: {
      gameId: 'g1',
      sport: 'soccer',
      status: ended ? 'final' : 'live',
      home: { name: 'Portugal', short: 'POR' },
      away: { name: 'Spain', short: 'ESP' },
      score: { home: 2, away: 1 },
      clock: { period: 2, display: ended ? 'FT' : "67'" },
      minute: 67,
      lastSeq: 120,
      counters: {},
      periodScores: [],
    },
    scorecard: {
      entries: [
        { marketId: 'm-card', question: 'Yellow card before the 60th minute?', outcome: 'yes', room: 0.62, model: 0.5 },
        { marketId: 'x1', question: 'Goal in the first 15 minutes?', outcome: 'no', room: 0.7, model: 0.74, gemini: 0.77 },
        { marketId: 'x2', question: 'Portugal leads at half time?', outcome: 'yes', room: 0.48, model: 0.41, gemini: 0.44 },
      ],
      n: 3,
      nGemini: 2,
      brier: { room: 0.142, model: 0.171, gemini: 0.158, roomOnGeminiSubset: 0.166, modelOnGeminiSubset: 0.191 },
      verdict: 'The room is beating the model by 0.03 tonight; Gemini is still ahead on the shared questions.',
    },
    gemini: { available: true, source: 'mock', events: [] },
    you: {
      pubkey: ME,
      name: 'You',
      state: null,
      positions,
      drafts: ended
        ? []
        : [{ id: 'd1', player: ME, marketId: 'm-goals', outcome: 'yes', amount: 5 * USDC, source: 'voice', createdAt: iso(now - 2_000), expiresAt: iso(now + 60_000) }],
      momentMarketsAllowed: true,
    },
    announcer,
    serverTime: iso(now),
    role: 'player',
  };
}

export class FixtureClient implements PartyClient {
  private view: ClientView;
  private listeners = new Set<() => void>();

  constructor(variant: string) {
    const snapshot = build(variant);
    if (variant === 'buyin') {
      snapshot.you!.positions = [];
      snapshot.you!.drafts = [];
      const me = snapshot.players.find((p) => p.pubkey === ME)!;
      Object.assign(me, { deposited: 0, balance: 0, locked: 0, pnl: 0 });
    }
    this.view = {
      status: 'ready',
      snapshot,
      lastSigned: null,
      cosignMismatch: null,
      lastError: null,
      lastGameEvent: null,
      chainEvents:
        variant === 'end'
          ? [{ kind: 'withdraw', signature: '5xDemoPayoutSignature', partyAddress: 'PartyDemo', member: ME, amount: 11.2 * USDC, via: 'mock', explorerUrl: 'https://explorer.solana.com/tx/5xDemoPayoutSignature?cluster=devnet' }]
          : [],
      led: null,
      clockSkewMs: 0,
    };
  }

  private timer: ReturnType<typeof setInterval> | null = null;

  getView = () => this.view;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    // Keep the moment markets cycling so the countdown ring is always visible while reviewing.
    this.timer ??= setInterval(() => {
      const now = Date.now();
      const stale = this.view.snapshot?.markets.some((m) => m.state === 'open' && m.kind === 'moment' && m.lock.at && Date.parse(m.lock.at) < now - 3000);
      if (stale)
        this.mutate((s) => {
          for (const m of s.markets)
            if (m.state === 'open' && m.kind === 'moment' && m.lock.at && Date.parse(m.lock.at) < now - 3000) {
              m.openedAt = new Date(now).toISOString();
              m.lock = { ...m.lock, at: new Date(now + 30_000).toISOString() };
            }
        });
    }, 1000);
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  };
  now = () => Date.now();
  close() {}

  private mutate(fn: (s: PartySnapshot) => void) {
    const s = structuredClone(this.view.snapshot!);
    fn(s);
    this.view = { ...this.view, snapshot: s };
    this.listeners.forEach((l) => l());
  }

  async buyIn(amount: number) {
    await new Promise((r) => setTimeout(r, 900));
    this.mutate((s) => {
      const me = s.players.find((p) => p.pubkey === ME)!;
      me.deposited += amount;
      me.balance += amount;
    });
  }

  async request(body: ClientRequest): Promise<Record<string, unknown>> {
    await new Promise((r) => setTimeout(r, 250));
    this.mutate((s) => {
      const you = s.you!;
      const me = s.players.find((p) => p.pubkey === ME)!;
      const market = (id: string) => s.markets.find((m) => m.id === id)!;
      switch (body.type) {
        case 'place_bet': {
          const m = market(body.marketId);
          const pos: Position = { partyId: m.partyId, marketId: m.id, player: ME, outcome: body.outcome, stake: body.stake };
          if (m.mode === 'pool') {
            m.pool = { ...m.pool, [body.outcome]: (m.pool?.[body.outcome] ?? 0) + body.stake };
            const total = Object.values(m.pool).reduce((a, c) => a + c, 0);
            m.price = Object.fromEntries(m.outcomes.map((o) => [o.id, (m.pool![o.id] ?? 0) / total]));
          } else if (m.mode === 'amm' && m.q && m.ammB) {
            const quote = quoteBuySpend(m.q, m.ammB, body.outcome, body.stake);
            m.q = quote.newQ;
            m.price = lmsrPrices(m.q, m.ammB);
            pos.shares = quote.shares;
            pos.stake = quote.cost;
          }
          you.positions.push(pos);
          me.balance -= pos.stake;
          me.locked += pos.stake;
          break;
        }
        case 'amm_trade': {
          you.positions = you.positions.filter((p) => !(p.marketId === body.marketId && p.outcome === body.outcome));
          break;
        }
        case 'confirm_draft':
        case 'reject_draft':
          you.drafts = you.drafts.filter((d) => d.id !== body.draftId);
          break;
        case 'cancel_offer':
          s.offers = s.offers.map((o) => (o.id === body.offerId ? { ...o, open: false } : o));
          break;
        case 'dispute':
          market(body.marketId).state = 'disputed';
          break;
        case 'sync_mark':
          you.delayMs = 25_000;
          you.momentMarketsAllowed = false;
          break;
      }
    });
    return {};
  }
}

export function fixtureVariant(): string | null {
  const v = new URLSearchParams(window.location.search).get('fixture');
  return v ? (v === '1' ? 'live' : v) : null;
}
