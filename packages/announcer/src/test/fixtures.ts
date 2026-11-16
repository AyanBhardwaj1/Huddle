import { USDC, type AnnouncerEvent, type Fill, type Market, type RoomContext, type Scorecard, type TalkContext } from '@huddle/shared';

/** Shared test fixtures: a Portugal v Spain party with three markets. */

export function market(over: Partial<Market> & Pick<Market, 'id' | 'question'>): Market {
  return {
    partyId: 'party1',
    kind: 'moment',
    mode: 'pool',
    outcomes: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    prior: { yes: 0.5, no: 0.5 },
    price: { yes: 0.5, no: 0.5 },
    lock: { manual: true },
    resolver: { type: 'manual', params: {} },
    state: 'open',
    createdBy: 'ai',
    volume: 0,
    createdAt: '2026-11-18T19:00:00.000Z',
    ...over,
  };
}

export const penalty = market({
  id: 'm-pen',
  question: 'Will Ronaldo score this penalty?',
  hook: 'Penalty to Portugal! Ronaldo steps up.',
  prior: { yes: 0.76, no: 0.24 },
  price: { yes: 0.77, no: 0.23 },
  templateId: 'soccer.penalty',
  openedAt: '2026-11-18T19:42:00.000Z',
});

export const corners = market({
  id: 'm-corners',
  question: 'Will Portugal reach 7 corners?',
  kind: 'game',
  prior: { yes: 0.4, no: 0.6 },
  price: { yes: 0.61, no: 0.39 },
  openedAt: '2026-11-18T19:05:00.000Z',
});

export const winner = market({
  id: 'm-winner',
  question: 'Who wins the match?',
  kind: 'game',
  mode: 'amm',
  outcomes: [
    { id: 'home', label: 'Portugal' },
    { id: 'draw', label: 'Draw' },
    { id: 'away', label: 'Spain' },
  ],
  prior: { home: 0.45, draw: 0.27, away: 0.28 },
  price: { home: 0.52, draw: 0.23, away: 0.25 },
  geminiRef: { eventTicker: 'POR-ESP', contractTicker: 'POR-ESP-POR', prob: 0.46, asOf: '2026-11-18T19:40:00.000Z', outcomeId: 'home', label: 'Portugal' },
  openedAt: '2026-11-18T19:01:00.000Z',
});

export const lockedMarket = market({
  id: 'm-locked',
  question: 'Will there be a red card before half time?',
  state: 'locked',
  price: { yes: 0.12, no: 0.88 },
  openedAt: '2026-11-18T19:20:00.000Z',
});

export function room(over: Partial<RoomContext> = {}): RoomContext {
  return {
    partyName: 'Ayan’s place',
    persona: 'soccer',
    sport: 'soccer',
    points: false,
    score: 'Portugal 2-1 Spain',
    clock: "63'",
    home: 'Portugal',
    away: 'Spain',
    leaderboard: [
      { name: 'Ayan', pnl: 12 * USDC, streak: 3 },
      { name: 'Priya', pnl: 3 * USDC },
      { name: 'Jake', pnl: -8 * USDC },
    ],
    recentResults: [{ question: 'Will Portugal score before half time?', outcome: 'Yes' }],
    ...over,
  };
}

export function talk(over: Partial<TalkContext> = {}): TalkContext {
  return {
    ...room(),
    speaker: { pubkey: 'pkJake', name: 'Jake', balance: 20 * USDC },
    markets: [winner, corners, penalty, lockedMarket],
    ...over,
  };
}

export function fill(over: Partial<Fill> = {}): Fill {
  return {
    id: 'f1',
    marketId: penalty.id,
    player: 'pkJake',
    playerName: 'Jake',
    kind: 'pool_bet',
    outcome: 'no',
    amount: 8 * USDC,
    at: '2026-11-18T19:42:05.000Z',
    ...over,
  };
}

export const scorecard: Scorecard = {
  entries: [],
  n: 9,
  nGemini: 2,
  brier: { room: 0.18, model: 0.22, gemini: 0.2, roomOnGeminiSubset: 0.19, modelOnGeminiSubset: 0.21 },
  verdict: 'The room beat the model tonight, and edged Gemini too',
};

/** One of every announcer event (PRD section 7 table plus the extra contract events). */
export function allEvents(): AnnouncerEvent[] {
  return [
    { type: 'market_opened', market: penalty, lockInSecs: 20 },
    { type: 'market_opened', market: winner },
    { type: 'lock_soon', market: penalty, secondsLeft: 5 },
    { type: 'market_locked', market: penalty },
    { type: 'big_trade', market: penalty, fill: fill(), outcomeLabel: 'No' },
    {
      type: 'market_resolved',
      market: { ...penalty, state: 'resolved', outcome: 'yes', roomProbAtLock: { yes: 0.77, no: 0.23 } },
      outcomeLabel: 'Yes',
      winners: [{ name: 'Priya', amount: 6 * USDC }],
      losers: [{ name: 'Jake', amount: 8 * USDC }],
    },
    { type: 'market_voided', market: corners, reason: 'the feed lost the corner count' },
    { type: 'player_joined', name: 'Priya', amount: 10 * USDC, remote: true, city: 'Chicago' },
    { type: 'leaderboard_change', leader: 'Ayan', pnl: 12 * USDC },
    {
      type: 'game_recap',
      scorecard,
      leaderboard: [
        { name: 'Ayan', pnl: 12 * USDC },
        { name: 'Priya', pnl: 3 * USDC },
      ],
      biggestSwing: { name: 'Jake', amount: 8 * USDC, question: penalty.question },
      finalScore: 'Portugal 2-1 Spain',
    },
    { type: 'talk_reply', text: 'Yes is at 77%.' },
  ];
}

/** A logger that records what was logged. */
export function recordingLogger(): { info: (m: string) => void; warn: (m: string) => void; infos: string[]; warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return { info: (m) => infos.push(m), warn: (m) => warns.push(m), infos, warns };
}

export const FAKE_MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x00]);

export function audioResponse(bytes: Uint8Array = FAKE_MP3): Response {
  return new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
