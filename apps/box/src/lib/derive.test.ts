import {
  buildScorecard,
  DEFAULT_PARTY_CONFIG,
  USDC,
  type Fill,
  type GameInfo,
  type Market,
  type Party,
  type PlayerPublic,
} from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import {
  activeMoment,
  brierBars,
  countdown,
  detectSettled,
  formatSecs,
  gameTiles,
  groupGames,
  leaderboard,
  moneyShort,
  nextView,
  payoutLine,
  prosRow,
  priceHistory,
  resultSummary,
  settlementSteps,
  tickerItems,
} from './derive';

describe('priceHistory', () => {
  const m = {
    id: 'm1',
    outcomes: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    prior: { yes: 0.6, no: 0.4 },
    openedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Market;
  const f = (id: string, outcome: string, price: number | undefined, at: string, marketId = 'm1') =>
    ({ id, marketId, outcome, price, at, kind: 'amm_buy', amount: 1, player: 'p', playerName: 'P' }) as Fill;
  it('starts at the prior and follows fills, mirroring the other side of a binary market', () => {
    const h = priceHistory(m, [
      f('a', 'yes', 0.65, '2026-01-01T00:00:02.000Z'),
      f('b', 'no', 0.3, '2026-01-01T00:00:04.000Z'),
      f('c', 'yes', undefined, '2026-01-01T00:00:05.000Z'),
      f('d', 'yes', 0.9, '2026-01-01T00:00:06.000Z', 'other'),
    ]);
    expect(h.map((x) => x.p)).toEqual([0.6, 0.65, 0.7]);
  });
});

const YN = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];
function mk(p: Partial<Market> & { id: string }): Market {
  return {
    partyId: 'p',
    question: 'Q?',
    kind: 'moment',
    mode: 'pool',
    outcomes: YN,
    prior: { yes: 0.6, no: 0.4 },
    price: { yes: 0.6, no: 0.4 },
    lock: { manual: true },
    resolver: { type: 'manual', params: {} },
    state: 'open',
    createdBy: 'ai',
    volume: 0,
    createdAt: '2026-11-16T10:00:00.000Z',
    ...p,
  };
}
const party = (settlement: Party['config']['settlement'], status: Party['status'] = 'live') =>
  ({ config: { ...DEFAULT_PARTY_CONFIG, settlement }, status, chain: { partyAddress: 'x' } }) as unknown as Party;

describe('takeover + tiles', () => {
  it('picks the newest open moment market, else the newest locked one', () => {
    const a = mk({ id: 'a', openedAt: '2026-11-16T10:00:01.000Z' });
    const b = mk({ id: 'b', openedAt: '2026-11-16T10:00:05.000Z' });
    const c = mk({ id: 'c', state: 'locked', openedAt: '2026-11-16T10:00:09.000Z' });
    const g = mk({ id: 'g', kind: 'game', openedAt: '2026-11-16T10:01:00.000Z' });
    expect(activeMoment([a, b, c, g])?.id).toBe('b');
    expect(activeMoment([c, mk({ id: 'r', state: 'resolved' })])?.id).toBe('c');
    expect(activeMoment([g])).toBeNull();
  });
  it('orders game tiles open > locked > disputed > settled and caps them', () => {
    const tiles = gameTiles([
      mk({ id: 'f', kind: 'game', state: 'final' }),
      mk({ id: 'l', kind: 'game', state: 'locked' }),
      mk({ id: 'o', kind: 'game', state: 'open' }),
      mk({ id: 'd', kind: 'game', state: 'draft' }),
      mk({ id: 'v', kind: 'game', state: 'voided' }),
    ]);
    expect(tiles.map((t) => t.id)).toEqual(['o', 'l', 'f']);
    expect(gameTiles(Array.from({ length: 9 }, (_, i) => mk({ id: `g${i}`, kind: 'game' }))).length).toBe(4);
  });
});

describe('countdown', () => {
  const m = mk({ id: 'm', openedAt: '2026-11-16T10:00:00.000Z', lock: { at: '2026-11-16T10:00:20.000Z', manual: true } });
  const t0 = Date.parse('2026-11-16T10:00:00.000Z');
  it('computes remaining time, fraction and urgency', () => {
    expect(countdown(m, t0)).toMatchObject({ remainingMs: 20000, fraction: 1, urgent: false, label: '20' });
    expect(countdown(m, t0 + 15_500)).toMatchObject({ urgent: true, label: '5' });
    expect(countdown(m, t0 + 25_000)).toMatchObject({ remainingMs: 0, fraction: 0, label: '0' });
  });
  it('is null without a wall-clock lock or once locked', () => {
    expect(countdown(mk({ id: 'x' }), t0)).toBeNull();
    expect(countdown({ ...m, state: 'locked' }, t0)).toBeNull();
  });
  it('formats seconds', () => {
    expect(formatSecs(18_400)).toBe('19');
    expect(formatSecs(83_000)).toBe('1:23');
  });
});

describe('result reveal', () => {
  it('reports only transitions seen live, never on the first snapshot', () => {
    const open = mk({ id: 'a' });
    expect(detectSettled(new Map(), [{ ...open, state: 'resolved' }])).toEqual([]);
    const prev = new Map([
      ['a', 'open' as const],
      ['b', 'locked' as const],
      ['c', 'resolved' as const],
      ['d', 'disputed' as const],
      ['e', 'disputed' as const],
    ]);
    const now = [
      mk({ id: 'a', state: 'resolved' }),
      mk({ id: 'b', state: 'voided' }),
      mk({ id: 'c', state: 'final' }),
      mk({ id: 'd', state: 'voided' }),
      mk({ id: 'e', state: 'final' }),
    ];
    expect(detectSettled(prev, now).map((m) => m.id)).toEqual(['a', 'b', 'd']);
  });

  it('summarizes who backed the winner and the losers from fills', () => {
    const m = mk({ id: 'm', state: 'resolved', outcome: 'yes' });
    const f = (player: string, kind: Fill['kind'], outcome: string, amount: number, marketId = 'm'): Fill => ({
      id: `${player}${kind}${outcome}${amount}`,
      marketId,
      player,
      playerName: player.toUpperCase(),
      kind,
      outcome,
      amount: amount * USDC,
      at: '',
    });
    const s = resultSummary(m, [
      f('jake', 'amm_buy', 'no', 8),
      f('priya', 'pool_bet', 'yes', 5),
      f('leo', 'amm_buy', 'yes', 3),
      f('leo', 'amm_sell', 'yes', 3), // cashed out fully: neither won nor lost
      f('mia', 'pool_bet', 'yes', 1),
      f('mia', 'pool_bet', 'no', 2),
      f('ayan', 'pool_bet', 'yes', 9, 'other-market'),
      f('priya', 'payout', 'yes', 12),
    ]);
    expect(s.winnerLabel).toBe('Yes');
    // Priya's payout fill (12) has landed, so her line shows profit (12 - 5); Mia's has not yet.
    expect(s.winners).toEqual([
      { name: 'PRIYA', amount: 5 * USDC, profit: 7 * USDC },
      { name: 'MIA', amount: 1 * USDC },
    ]);
    expect(s.losers).toEqual([
      { name: 'JAKE', amount: 8 * USDC },
      { name: 'MIA', amount: 2 * USDC },
    ]);
  });
});

describe('pros row', () => {
  it('compares room, model and Gemini on the Gemini outcome', () => {
    const m = mk({
      id: 'm',
      prior: { yes: 0.77, no: 0.23 },
      price: { yes: 0.3, no: 0.7 },
      geminiRef: { eventTicker: 'E', contractTicker: 'C', prob: 0.25, asOf: '', outcomeId: 'no' },
    });
    expect(prosRow(m)).toEqual({ outcomeLabel: 'No', room: 0.7, model: 0.23, gemini: 0.25, geminiLabel: undefined });
    expect(prosRow(mk({ id: 'x' }))?.gemini).toBeUndefined();
  });
});

describe('money + labels', () => {
  it('formats money and points', () => {
    expect(moneyShort(10 * USDC, party('vault'))).toBe('$10');
    expect(moneyShort(10.5 * USDC, party('vault'))).toBe('$10.50');
    expect(moneyShort(3 * USDC, party('points'), { sign: true })).toBe('+3 pts');
    expect(moneyShort(-4.6 * USDC, party('trusted'))).toBe('-$4.60');
    expect(payoutLine(0.77, party('vault'))).toBe('$1 pays $1.30');
    expect(payoutLine(0.5, party('points'))).toBe('1 pt pays 2.00');
  });
  it('ranks players without the house', () => {
    const p = (name: string, pnl: number, isHouse = false) => ({ name, pnl, isHouse }) as PlayerPublic;
    expect(leaderboard([p('b', 1), p('House', 99, true), p('a', 1), p('c', 5)]).map((x) => x.name)).toEqual(['c', 'a', 'b']);
  });
  it('builds ticker items newest first, skipping payouts', () => {
    const m = mk({ id: 'm' });
    const fills: Fill[] = [
      { id: '1', marketId: 'm', player: 'p', playerName: 'Jake', kind: 'amm_buy', outcome: 'no', amount: USDC, at: '' },
      { id: '2', marketId: 'm', player: 'p', playerName: 'Jake', kind: 'payout', outcome: 'no', amount: USDC, at: '' },
      { id: '3', marketId: 'm', player: 'q', playerName: 'Priya', kind: 'pool_bet', outcome: 'yes', amount: USDC, at: '' },
    ];
    const items = tickerItems(fills, [m]);
    expect(items.map((i) => `${i.name} ${i.verb} ${i.outcomeLabel} ${i.dir}`)).toEqual(['Priya backs Yes up', 'Jake buys No down']);
  });
  it('groups games by sport with live and replay first', () => {
    const g = (id: string, sport: 'soccer' | 'nfl', status: GameInfo['status']) => ({ id, sport, status, title: id }) as GameInfo;
    const out = groupGames([g('z', 'soccer', 'scheduled'), g('a', 'nfl', 'replay'), g('y', 'soccer', 'replay'), g('x', 'soccer', 'live')]);
    expect(out.map((x) => [x.sport, x.games.map((y) => y.id)])).toEqual([
      ['soccer', ['x', 'y', 'z']],
      ['nfl', ['a']],
    ]);
  });
});

describe('scorecard + settlement', () => {
  it('marks the lowest Brier as best and hides Gemini without data', () => {
    const sc = buildScorecard([
      { marketId: 'a', question: '', outcome: 'yes', room: 0.9, model: 0.6 },
      { marketId: 'b', question: '', outcome: 'no', room: 0.7, model: 0.6 },
    ]);
    const bars = brierBars(sc);
    expect(bars.map((b) => b.id)).toEqual(['room', 'model']);
    expect(bars.find((b) => b.best)?.id).toBe('room');
    const withG = brierBars(buildScorecard([{ marketId: 'a', question: '', outcome: 'yes', room: 0.5, model: 0.6, gemini: 0.95 }]));
    expect(withG.find((b) => b.best)?.id).toBe('gemini');
  });
  it('walks ended -> closing -> finalized', () => {
    expect(settlementSteps(party('vault', 'ended')).map((s) => s.state)).toEqual(['active', 'todo', 'todo']);
    expect(settlementSteps(party('vault', 'closing')).map((s) => s.state)).toEqual(['done', 'active', 'todo']);
    expect(settlementSteps(party('vault', 'finalized')).map((s) => s.state)).toEqual(['done', 'done', 'done']);
    expect(settlementSteps(party('points', 'finalized'))[2]!.label).toBe('Scores locked');
  });
  it('NEXT cycles board -> host -> scorecard -> board', () => {
    expect(nextView('board')).toBe('host');
    expect(nextView('host')).toBe('scorecard');
    expect(nextView('scorecard')).toBe('board');
  });
});
