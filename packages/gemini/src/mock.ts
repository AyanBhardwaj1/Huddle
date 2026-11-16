import type { GameInfo, GeminiClient, GeminiPanel, GeminiRef, MarketCandidate, Outcome } from '@huddle/shared';
import { buildPanel, refFor, type RawContract, type RawEvent } from './mapping';

export const MOCK_NOTE = 'Offline SAMPLE odds (Gemini mock), not live Gemini prices.';

function cents(p: number): string {
  return (Math.round(p * 100) / 100).toFixed(2);
}

/** A two-sided quote one cent either side of `p`, plus a last trade, like a liquid Gemini book. */
function book(p: number, last = true): RawContract['prices'] {
  const mid = Math.min(0.98, Math.max(0.02, p));
  const prices: Record<string, string> = { bestBid: cents(mid - 0.01), bestAsk: cents(mid + 0.01) };
  if (last) prices.lastTradePrice = cents(mid);
  return prices;
}

/**
 * Realistic-looking sample events in Gemini's own payload shape (same parser as live), so the whole
 * "Friends vs. the Pros" flow works offline. Tickers start with MOCK- and the panel says `source: 'mock'`.
 */
export function mockEvents(game: GameInfo): RawEvent[] {
  const h = game.home.short.toUpperCase();
  const a = game.away.short.toUpperCase();
  const base = `MOCK-${game.sport === 'nfl' ? 'NFL' : 'SOC'}-${a}-${h}`;
  const title = `${game.away.name} vs ${game.home.name}`;
  const participants = [
    { name: game.home.name, abbreviation: h, side: 'home' },
    { name: game.away.name, abbreviation: a, side: 'away' },
  ];
  const contract = (ticker: string, label: string, p: number, side?: string): RawContract => ({ ticker, label, instrumentSymbol: `GEMI-${base}-${ticker}`, prices: book(p), status: 'active', marketState: 'open', sportsSide: side });

  if (game.sport === 'nfl') {
    const period = (suffix: string, ordinal: number, type: 'quarter' | 'half', name: string, ph: number, pt: number): RawEvent => ({
      ticker: `${base}-${suffix}`,
      title: `${title}: ${name} Moneyline`,
      status: 'active',
      participants,
      sportsMarket: { sport: 'american_football', type: 'moneyline', subject: 'contest', scope: { type, ordinal } },
      contracts: [contract(h, `${game.home.name} wins ${name}`, ph, 'home'), contract(a, `${game.away.name} wins ${name}`, 1 - ph - pt, 'away'), contract('D', `Tie in ${name}`, pt)],
    });
    return [
      {
        ticker: `${base}-M`,
        title,
        status: 'active',
        participants,
        sportsMarket: { sport: 'american_football', type: 'moneyline', subject: 'contest', scope: { type: 'full_contest' } },
        contracts: [contract(h, game.home.name, 0.58, 'home'), contract(a, game.away.name, 0.42, 'away')],
      },
      period('1QM', 1, 'quarter', '1st Quarter', 0.43, 0.21),
      period('2QM', 2, 'quarter', '2nd Quarter', 0.48, 0.14),
      period('1HM', 1, 'half', '1st Half', 0.52, 0.07),
      period('2HM', 2, 'half', '2nd Half', 0.5, 0.08),
      period('3QM', 3, 'quarter', '3rd Quarter', 0.41, 0.19),
      period('4QM', 4, 'quarter', '4th Quarter', 0.45, 0.15),
      {
        ticker: `${base}-T`,
        title: `${title}: Total Points`,
        status: 'active',
        participants,
        sportsMarket: { sport: 'american_football', type: 'total', subject: 'contest', metric: 'points', scope: { type: 'full_contest' } },
        contracts: [
          contract('O38', 'More than 38.5 points scored', 0.68),
          contract('O41', 'More than 41.5 points scored', 0.59),
          contract('O44', 'More than 44.5 points scored', 0.5),
          contract('O47', 'More than 47.5 points scored', 0.41),
          contract('O50', 'More than 50.5 points scored', 0.33),
        ],
      },
    ];
  }

  return [
    {
      ticker: `${base}-M`,
      title,
      status: 'active',
      participants,
      sportsMarket: { sport: 'soccer', type: 'moneyline', subject: 'contest', scope: { type: 'regulation' } },
      contracts: [contract(h, game.home.name, 0.44, 'home'), contract('D', 'Draw', 0.27), contract(a, game.away.name, 0.29, 'away')],
    },
    {
      ticker: `${base}-REGT`,
      title: `${title}: Total Goals`,
      status: 'active',
      participants,
      sportsMarket: { sport: 'soccer', type: 'total', subject: 'contest', metric: 'goals', scope: { type: 'regulation' } },
      contracts: [contract('O1', 'Reg Time: More than 1.5 goals scored', 0.72), contract('O2', 'Reg Time: More than 2.5 goals scored', 0.46), contract('O3', 'Reg Time: More than 3.5 goals scored', 0.24)],
    },
  ];
}

/** Offline Gemini (`GEMINI_MOCK=1`, or the automatic fallback when the live API is unreachable). */
export class OfflineGeminiClient implements GeminiClient {
  readonly source = 'mock' as const;

  constructor(private readonly now: () => number = () => Date.now()) {}

  async matchGame(game: GameInfo, note: string = MOCK_NOTE): Promise<GeminiPanel> {
    const panel = buildPanel(mockEvents(game), game, 'mock', new Date(this.now()).toISOString());
    return { ...panel, note };
  }

  async refresh(panel: GeminiPanel): Promise<GeminiPanel> {
    const asOf = new Date(this.now()).toISOString();
    return { ...panel, asOf, events: panel.events.map((e) => ({ ...e, contracts: e.contracts.map((c) => ({ ...c, asOf })) })) };
  }

  refFor(panel: GeminiPanel, hint: MarketCandidate['geminiHint'], outcomes: Outcome[], game: GameInfo): GeminiRef | undefined {
    return refFor(panel, hint, outcomes, game);
  }
}
