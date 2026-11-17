import {
  buildScorecard,
  USDC,
  DEFAULT_PARTY_CONFIG,
  type ChainEvent,
  type ClientView,
  type Fill,
  type Market,
  type PartySnapshot,
  type PartyStatus,
  type PlayerPublic,
} from '@huddle/shared';
import { useEffect, useState } from 'react';
import type { FixtureKind } from './lib/config';
import type { BoardView } from './lib/derive';

/**
 * Review-only fixtures (`?fixture=<kind>`, see FIXTURE_KINDS in lib/config.ts): a realistic static
 * party per state so every box screen can be reviewed and screenshotted without an engine. The
 * live kinds gently animate prices and loop the countdown so the motion can be judged too.
 * Nothing here is used in normal operation.
 */

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const PK = (n: number) => `Fx${String(n).padStart(2, '0')}${'1'.repeat(38)}`;

function player(n: number, name: string, deposited: number, pnl: number, extra: Partial<PlayerPublic> = {}): PlayerPublic {
  return {
    pubkey: PK(n),
    name,
    isHouse: false,
    remote: false,
    connected: true,
    deposited: deposited * USDC,
    balance: (deposited + pnl) * USDC,
    locked: 0,
    pnl: pnl * USDC,
    joinedAt: iso(-600_000 + n * 1000),
    ...extra,
  };
}

function market(p: Partial<Market> & Pick<Market, 'id' | 'question' | 'kind' | 'mode' | 'outcomes' | 'prior' | 'state'>): Market {
  return {
    partyId: 'party-fx',
    lock: { manual: true },
    resolver: { type: 'manual', params: {} },
    createdBy: 'ai',
    price: p.prior,
    volume: 0,
    createdAt: iso(-300_000),
    ...p,
  };
}

const YN = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

/** Board view a fixture starts in. */
export function fixtureFlags(kind: FixtureKind): { view?: BoardView } {
  if (kind === 'scorecard') return { view: 'scorecard' };
  if (kind === 'host') return { view: 'host' };
  return {};
}

function statusFor(kind: FixtureKind): PartyStatus {
  if (kind === 'lobby' || kind === 'lobby-empty') return 'lobby';
  if (kind === 'end') return 'closing';
  if (kind === 'final') return 'finalized';
  return 'live';
}

function penaltyFor(kind: FixtureKind): Market {
  const base = market({
    id: 'm-pen',
    question: 'Ronaldo steps up. Does he score this penalty?',
    kind: 'moment',
    mode: 'amm',
    outcomes: YN,
    prior: { yes: 0.77, no: 0.23 },
    price: { yes: 0.71, no: 0.29 },
    geminiRef: { eventTicker: 'POR-ESP', contractTicker: 'POR-PEN', prob: 0.74, asOf: iso(-4000), outcomeId: 'yes' },
    lock: { at: iso(18_000), onEvent: 'penalty_result', manual: true },
    openedAt: iso(-2_000),
    volume: 23.4 * USDC,
    state: 'open',
    hook: 'Room has him at 71%.',
  });
  if (kind === 'urgent') return { ...base, lock: { ...base.lock, at: iso(4_600) }, openedAt: iso(-15_400) };
  if (kind === 'locked') return { ...base, state: 'locked', lockedAt: iso(-1500), roomProbAtLock: base.price };
  return base;
}

function marketsFor(kind: FixtureKind): Market[] {
  if (kind === 'lobby' || kind === 'lobby-empty' || kind === 'idle') return [];
  const game: Market[] = [
    market({
      id: 'g-win',
      question: 'Who wins it?',
      kind: 'game',
      mode: 'pool',
      outcomes: [
        { id: 'POR', label: 'Portugal' },
        { id: 'draw', label: 'Draw' },
        { id: 'ESP', label: 'Spain' },
      ],
      prior: { POR: 0.46, draw: 0.27, ESP: 0.27 },
      price: { POR: 0.52, draw: 0.18, ESP: 0.3 },
      pool: { POR: 26 * USDC, draw: 9 * USDC, ESP: 15 * USDC },
      volume: 50 * USDC,
      state: 'open',
    }),
    market({
      id: 'g-seven',
      question: 'Will Portugal score 7 or more tonight?',
      kind: 'game',
      mode: 'amm',
      outcomes: YN,
      prior: { yes: 0.04, no: 0.96 },
      price: { yes: 0.09, no: 0.91 },
      geminiRef: { eventTicker: 'POR-ESP', contractTicker: 'POR-7', prob: 0.03, asOf: iso(-4000), outcomeId: 'yes' },
      volume: 12.2 * USDC,
      state: 'open',
    }),
    market({
      id: 'g-card',
      question: 'First yellow card goes to…',
      kind: 'game',
      mode: 'bet',
      outcomes: [
        { id: 'POR', label: 'Portugal' },
        { id: 'ESP', label: 'Spain' },
      ],
      prior: { POR: 0.45, ESP: 0.55 },
      price: { POR: 0.4, ESP: 0.6 },
      volume: 8 * USDC,
      state: 'locked',
    }),
  ];
  const disputedGoal = market({
    id: 'm-goal60',
    question: 'Goal before the 60th minute?',
    kind: 'moment',
    mode: 'pool',
    outcomes: YN,
    prior: { yes: 0.42, no: 0.58 },
    price: { yes: 0.55, no: 0.45 },
    volume: 14 * USDC,
    state: 'disputed',
    outcome: 'no',
    dispute: { by: PK(2), reason: 'Ramos scored in the 58th, replay was late', at: iso(-6000) },
  });
  const draft = market({
    id: 'd-card',
    question: 'Spain picks up a card before half time?',
    kind: 'moment',
    mode: 'pool',
    outcomes: YN,
    prior: { yes: 0.38, no: 0.62 },
    state: 'draft',
  });
  if (kind === 'board') return [...game, draft];
  if (kind === 'threeway') {
    return [
      market({
        id: 'm-next',
        question: 'Who scores next before full time?',
        kind: 'moment',
        mode: 'pool',
        outcomes: [
          { id: 'POR', label: 'Portugal, Ronaldo or anyone' },
          { id: 'none', label: 'Nobody, it ends like this' },
          { id: 'ESP', label: 'Spain' },
        ],
        prior: { POR: 0.38, none: 0.3, ESP: 0.32 },
        price: { POR: 0.41, none: 0.26, ESP: 0.33 },
        pool: { POR: 12.3 * USDC, none: 7.8 * USDC, ESP: 9.9 * USDC },
        lock: { at: iso(40_000), manual: true },
        openedAt: iso(-5_000),
        volume: 30 * USDC,
        state: 'open',
      }),
      ...game,
    ];
  }
  if (kind === 'edge') {
    return [
      market({
        id: 'm-edge',
        question: 'Does the keeper save it?',
        kind: 'moment',
        mode: 'amm',
        outcomes: YN,
        prior: { yes: 0.02, no: 0.98 },
        price: { yes: 0.004, no: 0.996 },
        lock: { manual: true, onEvent: 'penalty_result' },
        openedAt: iso(-1_000),
        volume: 0,
        state: 'open',
      }),
      market({
        id: 'g-empty',
        question: 'Total corners: 10 or more?',
        kind: 'game',
        mode: 'pool',
        outcomes: YN,
        prior: { yes: 0.5, no: 0.5 },
        price: {},
        pool: { yes: 0, no: 0 },
        volume: 0,
        state: 'open',
      }),
    ];
  }
  const withDispute = kind === 'live' || kind === 'host' || kind === 'scorecard' || kind === 'reconnecting' || kind === 'end' || kind === 'final';
  return [penaltyFor(kind), ...game, ...(withDispute ? [disputedGoal] : []), draft];
}

function snapshot(kind: FixtureKind): PartySnapshot {
  const status = statusFor(kind);
  const lobby = status === 'lobby';
  const ended = status === 'closing' || status === 'finalized';
  const players: PlayerPublic[] =
    kind === 'lobby-empty'
      ? []
      : lobby
        ? [player(1, 'Jake', 10, 0), player(2, 'Priya', 10, 0, { remote: true }), player(3, 'Ayan', 20, 0)]
        : [
            player(1, 'Jake', 10, -4.6, { streak: -2 }),
            player(2, 'Priya', 10, 7.25, { remote: true, streak: 3 }),
            player(3, 'Ayan', 20, 3.1, { streak: 1 }),
            player(4, 'Mia', 10, -1.4),
            player(5, 'Leo', 10, 0.8),
            { ...player(9, 'House', 20, -1.15), isHouse: true },
          ];
  if (ended) for (const p of players) p.payout = p.balance;

  const markets = marketsFor(kind);
  const fill = (i: number, who: number, name: string, mId: string, k: Fill['kind'], outcome: string, amt: number, price?: number): Fill => ({
    id: `f${i}`,
    marketId: mId,
    player: PK(who),
    playerName: name,
    kind: k,
    outcome,
    amount: amt * USDC,
    price,
    at: iso(-60_000 + i * 4000),
  });
  const fills: Fill[] =
    lobby || kind === 'idle' || kind === 'edge'
      ? []
      : [
          fill(1, 3, 'Ayan', 'g-win', 'pool_bet', 'POR', 5, 0.52),
          fill(2, 4, 'Mia', 'g-seven', 'amm_buy', 'yes', 1.5, 0.09),
          fill(3, 2, 'Priya', 'm-goal60', 'pool_bet', 'yes', 4, 0.55),
          fill(4, 1, 'Jake', 'm-pen', 'amm_buy', 'no', 8, 0.29),
          fill(5, 2, 'Priya', 'm-pen', 'amm_buy', 'yes', 5, 0.71),
          fill(6, 5, 'Leo', 'm-pen', 'amm_buy', 'yes', 2, 0.73),
        ];

  const scorecard = buildScorecard([
    { marketId: 'a', question: 'Corner leads to a shot on target?', outcome: 'no', room: 0.62, model: 0.55, gemini: undefined },
    { marketId: 'b', question: 'Portugal lead at half time?', outcome: 'yes', room: 0.58, model: 0.49, gemini: 0.52 },
    { marketId: 'c', question: 'Next goal: Portugal?', outcome: 'yes', room: 0.66, model: 0.6, gemini: 0.63 },
    { marketId: 'd', question: 'Penalty saved?', outcome: 'no', room: 0.71, model: 0.79, gemini: 0.8 },
  ]);

  const lineFor = (): string => {
    if (lobby) return kind === 'lobby-empty' ? 'Doors are open. Tap your phone on the box to get in.' : "Priya's in for ten from Chicago!";
    if (ended) return 'Full time! Priya takes the night, up seven and a quarter. The room beat the model by four hundredths.';
    if (kind === 'idle') return 'Kick-off! Portugal against Spain. Markets open on every big moment.';
    if (kind === 'threeway') return 'Who scores next? Portugal at 41, nobody at 26, Spain at 33. Get in!';
    if (kind === 'locked') return 'Locked! No more bets. Here he comes…';
    if (kind === 'urgent') return 'Five seconds! Last call!';
    return 'Penalty to Portugal! Ronaldo steps up. Room has him at 71%. Twenty seconds, get in!';
  };

  return {
    party: {
      id: 'party-fx',
      code: 'KICK',
      name: "Ayan's watch party",
      hostPubkey: PK(9),
      boxSigner: PK(8),
      game: {
        id: 'replay-por-esp',
        sport: 'soccer',
        title: 'Portugal vs Spain',
        home: { name: 'Portugal', short: 'POR', color: '#C8102E' },
        away: { name: 'Spain', short: 'ESP', color: '#F1BF00' },
        status: 'replay',
        source: 'replay',
        durationMs: 5_400_000,
      },
      config: { ...DEFAULT_PARTY_CONFIG, defaultMode: 'amm', settlement: ended ? 'vault' : 'points', autoApprove: kind !== 'host' },
      status,
      createdAt: iso(-900_000),
      chain: {
        partyAddress: 'FxParty11111111111111111111111111111111111',
        challengeEndsAt: kind === 'end' ? iso(42_000) : kind === 'final' ? iso(-5_000) : undefined,
        explorerBase: 'https://explorer.solana.com',
      },
      joinUrl: 'http://192.168.1.20:8080/j/KICK',
    },
    players,
    markets,
    offers: [],
    fills,
    game: {
      gameId: 'replay-por-esp',
      sport: 'soccer',
      status: lobby ? 'pre' : ended ? 'final' : 'live',
      home: { name: 'Portugal', short: 'POR', color: '#C8102E' },
      away: { name: 'Spain', short: 'ESP', color: '#F1BF00' },
      score: lobby ? { home: 0, away: 0 } : ended ? { home: 3, away: 2 } : kind === 'idle' ? { home: 0, away: 0 } : { home: 2, away: 1 },
      clock: lobby ? { period: 0, display: "0'" } : ended ? { period: 2, display: 'FT' } : kind === 'idle' ? { period: 1, display: "1'" } : { period: 2, display: "67'" },
      minute: 67,
      lastSeq: 120,
      counters: {},
      periodScores: [],
    },
    scorecard,
    gemini: { available: true, source: 'mock', events: [] },
    replay: { gameId: 'replay-por-esp', playing: true, speed: 2, positionMs: 4_020_000, durationMs: 5_400_000, seq: 120, totalEvents: 210 },
    announcer: [
      {
        id: 'a1',
        text: lineFor(),
        priority: 'high',
        createdAt: iso(-1500),
        event: lobby ? 'player_joined' : ended ? 'game_recap' : 'market_opened',
        persona: 'soccer',
      },
    ],
    serverTime: iso(0),
    role: 'box',
  };
}

function chainEventsFor(kind: FixtureKind, snap: PartySnapshot): ChainEvent[] {
  if (kind !== 'end' && kind !== 'final') return [];
  const addr = snap.party.chain.partyAddress;
  const events: ChainEvent[] = [
    { kind: 'create_party', signature: '5fXcreate', partyAddress: addr, via: 'mock', explorerUrl: 'https://explorer.solana.com/tx/5fXcreate?cluster=devnet' },
    { kind: 'deposit', signature: '3aDep1', partyAddress: addr, member: PK(1), amount: 10 * USDC, via: 'quicknode' },
    { kind: 'deposit', signature: '3aDep2', partyAddress: addr, member: PK(2), amount: 10 * USDC, via: 'quicknode' },
    { kind: 'request_close', signature: '4cClose', partyAddress: addr, via: 'direct', explorerUrl: 'https://explorer.solana.com/tx/4cClose?cluster=devnet' },
    { kind: 'submit_state', signature: '2sState', partyAddress: addr, member: PK(2), via: 'quicknode' },
    {
      kind: 'withdraw',
      signature: '9wPay',
      partyAddress: addr,
      member: PK(2),
      amount: 17.25 * USDC,
      via: 'quicknode',
      explorerUrl: 'https://explorer.solana.com/tx/9wPay?cluster=devnet',
    },
  ];
  if (kind === 'final') {
    events.push(
      { kind: 'withdraw', signature: '9wPay3', partyAddress: addr, member: PK(3), amount: 23.1 * USDC, via: 'quicknode' },
      { kind: 'finalize', signature: '7fFinal', partyAddress: addr, via: 'direct', explorerUrl: 'https://explorer.solana.com/tx/7fFinal?cluster=devnet' },
    );
  }
  return events;
}

export function fixtureView(kind: FixtureKind): ClientView {
  if (kind === 'connecting') {
    return {
      status: 'connecting',
      snapshot: null,
      lastSigned: null,
      cosignMismatch: null,
      lastError: null,
      lastGameEvent: null,
      chainEvents: [],
      led: null,
      clockSkewMs: 0,
    };
  }
  const snap = snapshot(kind);
  const status = statusFor(kind);
  return {
    status: kind === 'reconnecting' ? 'reconnecting' : 'ready',
    snapshot: snap,
    lastSigned: null,
    cosignMismatch: null,
    lastError: null,
    lastGameEvent: null,
    chainEvents: chainEventsFor(kind, snap),
    led:
      status === 'lobby'
        ? { pattern: 'join', color: '#FFE27A' }
        : kind === 'urgent'
          ? { pattern: 'locking', color: '#F4F2EC' }
          : kind === 'locked'
            ? { pattern: 'locked', color: '#F4F2EC' }
            : status === 'live' && kind !== 'idle' && kind !== 'board'
              ? { pattern: 'market_open', color: '#FFE27A' }
              : { pattern: 'idle', color: '#4CB8FF' },
    clockSkewMs: 0,
  };
}

const ANIMATED: FixtureKind[] = ['live', 'scorecard', 'host', 'urgent', 'threeway', 'reconnecting'];

/**
 * Fixture view with light motion: the penalty price drifts and its countdown loops; `result` and
 * `voided` settle the penalty shortly after load (and again every 10 s) so the reveal plays.
 */
export function useFixtureView(kind: FixtureKind): ClientView {
  const [view, setView] = useState(() => fixtureView(kind));
  useEffect(() => {
    if (kind !== 'result' && kind !== 'voided') return;
    let n = 0;
    const settle = () => {
      n++;
      setView((v) => {
        const s = v.snapshot!;
        const markets = s.markets.map((m): Market => {
          if (m.id !== 'm-pen') return m;
          if (n % 2 === 0) return { ...penaltyFor('live') };
          return kind === 'voided'
            ? { ...m, state: 'voided', voidReason: 'host' }
            : { ...m, state: 'resolved', outcome: 'yes', roomProbAtLock: m.price, resolvedAt: iso(0) };
        });
        return { ...v, snapshot: { ...s, markets } };
      });
    };
    const first = setTimeout(settle, 900);
    const loop = setInterval(settle, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(loop);
    };
  }, [kind]);
  useEffect(() => {
    if (!ANIMATED.includes(kind)) return;
    let n = 0;
    const t = setInterval(() => {
      n++;
      setView((v) => {
        const s = v.snapshot!;
        const markets = s.markets.map((m) => {
          if (m.kind !== 'moment' || m.state !== 'open') return m;
          const lockAt = m.lock.at ? Date.parse(m.lock.at) : null;
          const expired = lockAt !== null && lockAt < Date.now();
          const ids = m.outcomes.map((o) => o.id);
          const first = ids[0]!;
          const p0 = Math.min(0.9, Math.max(0.3, (m.price[first] ?? 0.5) + (n % 3 === 0 ? -0.03 : 0.02)));
          const rest = ids.slice(1);
          const restSum = rest.reduce((a, id) => a + (m.price[id] ?? 0), 0) || 1;
          const price: Record<string, number> = { [first]: p0 };
          for (const id of rest) price[id] = ((m.price[id] ?? 0) / restSum) * (1 - p0);
          const window = kind === 'urgent' ? 6_000 : 20_000;
          return {
            ...m,
            price,
            volume: m.volume + 1.5 * USDC,
            lock: expired ? { ...m.lock, at: iso(window) } : m.lock,
            openedAt: expired ? iso(kind === 'urgent' ? -14_000 : 0) : m.openedAt,
          };
        });
        const moment = markets.find((m) => m.kind === 'moment' && m.state === 'open');
        if (!moment) return v;
        const names = ['Mia', 'Leo', 'Ayan', 'Jake'];
        const name = names[n % names.length]!;
        const out = moment.outcomes[n % 3 === 0 ? 1 : 0]!.id;
        const fill: Fill = {
          id: `fx-${n}`,
          marketId: moment.id,
          player: PK(10 + (n % 4)),
          playerName: name,
          kind: 'amm_buy',
          outcome: out,
          amount: (1 + (n % 4)) * USDC,
          price: moment.price[out],
          at: iso(0),
        };
        const players = s.players.map((p, i) => (i === n % 5 && !p.isHouse ? { ...p, pnl: p.pnl + (n % 2 ? 1 : -1) * 0.6 * USDC } : p));
        return { ...v, snapshot: { ...s, markets, players, fills: [...s.fills, fill].slice(-50) } };
      });
    }, 2500);
    return () => clearInterval(t);
  }, [kind]);
  return view;
}
