import {
  buildScorecard,
  USDC,
  DEFAULT_PARTY_CONFIG,
  type ClientView,
  type Fill,
  type Market,
  type PartySnapshot,
  type PlayerPublic,
} from '@huddle/shared';
import { useEffect, useState } from 'react';
import type { FixtureKind } from './lib/config';

/**
 * Review-only fixture (`?fixture=1|lobby|end|scorecard`): a realistic static party so the kiosk can
 * be reviewed and screenshotted without an engine. The live board gently animates prices and loops
 * the lock countdown so the motion can be judged too. Nothing here is used in normal operation.
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

function snapshot(kind: FixtureKind): PartySnapshot {
  const status = kind === 'lobby' ? 'lobby' : kind === 'end' ? 'closing' : 'live';
  const players: PlayerPublic[] =
    kind === 'lobby'
      ? [player(1, 'Jake', 10, 0), player(2, 'Priya', 10, 0, { remote: true }), player(3, 'Ayan', 20, 0)]
      : [
          player(1, 'Jake', 10, -4.6, { streak: -2 }),
          player(2, 'Priya', 10, 7.25, { remote: true, streak: 3 }),
          player(3, 'Ayan', 20, 3.1, { streak: 1 }),
          player(4, 'Mia', 10, -1.4),
          player(5, 'Leo', 10, 0.8),
          { ...player(9, 'House', 20, -1.15), isHouse: true },
        ];
  if (kind === 'end') {
    for (const p of players) p.payout = p.balance;
  }

  const penalty = market({
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
  const markets: Market[] =
    kind === 'lobby'
      ? []
      : [
          penalty,
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
          market({
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
          }),
          market({
            id: 'd-card',
            question: 'Spain picks up a card before half time?',
            kind: 'moment',
            mode: 'pool',
            outcomes: YN,
            prior: { yes: 0.38, no: 0.62 },
            state: 'draft',
          }),
        ];

  const fill = (i: number, who: number, name: string, mId: string, kind: Fill['kind'], outcome: string, amt: number, price?: number): Fill => ({
    id: `f${i}`,
    marketId: mId,
    player: PK(who),
    playerName: name,
    kind,
    outcome,
    amount: amt * USDC,
    price,
    at: iso(-60_000 + i * 4000),
  });
  const fills: Fill[] =
    kind === 'lobby'
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
      config: { ...DEFAULT_PARTY_CONFIG, defaultMode: 'amm', settlement: kind === 'end' ? 'vault' : 'points' },
      status,
      createdAt: iso(-900_000),
      chain: {
        partyAddress: 'FxParty11111111111111111111111111111111111',
        challengeEndsAt: kind === 'end' ? iso(42_000) : undefined,
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
      status: kind === 'lobby' ? 'pre' : kind === 'end' ? 'final' : 'live',
      home: { name: 'Portugal', short: 'POR', color: '#C8102E' },
      away: { name: 'Spain', short: 'ESP', color: '#F1BF00' },
      score: kind === 'lobby' ? { home: 0, away: 0 } : kind === 'end' ? { home: 3, away: 2 } : { home: 2, away: 1 },
      clock: kind === 'lobby' ? { period: 0, display: "0'" } : kind === 'end' ? { period: 2, display: 'FT' } : { period: 2, display: "67'" },
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
        text: kind === 'lobby' ? "Priya's in for ten from Chicago!" : 'Penalty to Portugal! Ronaldo steps up. Room has him at 71%. Twenty seconds, get in!',
        priority: 'high',
        createdAt: iso(-1500),
        event: kind === 'lobby' ? 'player_joined' : 'market_opened',
        persona: 'soccer',
      },
    ],
    serverTime: iso(0),
    role: 'box',
  };
}

export function fixtureView(kind: FixtureKind): ClientView {
  const snap = snapshot(kind);
  return {
    status: 'ready',
    snapshot: snap,
    lastSigned: null,
    cosignMismatch: null,
    lastError: null,
    lastGameEvent: null,
    chainEvents:
      kind === 'end'
        ? [
            { kind: 'create_party', signature: '5fXcreate', partyAddress: snap.party.chain.partyAddress, via: 'mock', explorerUrl: 'https://explorer.solana.com/tx/5fXcreate?cluster=devnet' },
            { kind: 'deposit', signature: '3aDep1', partyAddress: snap.party.chain.partyAddress, member: PK(1), amount: 10 * USDC, via: 'quicknode' },
            { kind: 'deposit', signature: '3aDep2', partyAddress: snap.party.chain.partyAddress, member: PK(2), amount: 10 * USDC, via: 'quicknode' },
            { kind: 'request_close', signature: '4cClose', partyAddress: snap.party.chain.partyAddress, via: 'direct', explorerUrl: 'https://explorer.solana.com/tx/4cClose?cluster=devnet' },
            { kind: 'submit_state', signature: '2sState', partyAddress: snap.party.chain.partyAddress, member: PK(2), via: 'quicknode' },
            { kind: 'withdraw', signature: '9wPay', partyAddress: snap.party.chain.partyAddress, member: PK(2), amount: 17.25 * USDC, via: 'quicknode', explorerUrl: 'https://explorer.solana.com/tx/9wPay?cluster=devnet' },
          ]
        : [],
    led: kind === 'lobby' ? { pattern: 'join', color: '#00E5A0' } : kind === 'live' ? { pattern: 'market_open', color: '#FFD60A' } : { pattern: 'idle', color: '#1E90FF' },
    clockSkewMs: 0,
  };
}

/** Fixture view with light motion: penalty price drifts and its countdown loops. */
export function useFixtureView(kind: FixtureKind): ClientView {
  const [view, setView] = useState(() => fixtureView(kind));
  useEffect(() => {
    if (kind !== 'live' && kind !== 'scorecard') return;
    let n = 0;
    const t = setInterval(() => {
      n++;
      setView((v) => {
        const s = v.snapshot!;
        const markets = s.markets.map((m) => {
          if (m.id !== 'm-pen') return m;
          const lockAt = Date.parse(m.lock.at!);
          const expired = lockAt < Date.now();
          const yes = Math.min(0.9, Math.max(0.55, (m.price.yes ?? 0.7) + (n % 3 === 0 ? -0.03 : 0.02)));
          return {
            ...m,
            price: { yes, no: 1 - yes },
            volume: m.volume + 1.5 * USDC,
            lock: expired ? { ...m.lock, at: iso(20_000) } : m.lock,
            openedAt: expired ? iso(0) : m.openedAt,
          };
        });
        const yes = markets[0]!.price.yes!;
        const names = ['Mia', 'Leo', 'Ayan', 'Jake'];
        const name = names[n % names.length]!;
        const fill: Fill = {
          id: `fx-${n}`,
          marketId: 'm-pen',
          player: PK(10 + (n % 4)),
          playerName: name,
          kind: 'amm_buy',
          outcome: n % 3 === 0 ? 'no' : 'yes',
          amount: (1 + (n % 4)) * USDC,
          price: n % 3 === 0 ? 1 - yes : yes,
          at: iso(0),
        };
        return { ...v, snapshot: { ...s, markets, fills: [...s.fills, fill].slice(-50) } };
      });
    }, 2500);
    return () => clearInterval(t);
  }, [kind]);
  return view;
}
