import type { RoomContext } from '../announcer';
import type { GameEvent, GameState } from '../events';
import type { MarketCandidate, QuestionEngine, QuestionRanker, RankedPick, ResolverResult } from '../interfaces';
import type { Market } from '../types';

const YES_NO = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

/**
 * Tiny stand-in for @huddle/models: a penalty market, a game-long total-goals market and a
 * next-goal market, with fixed priors. Enough to exercise every engine path.
 */
export class MockQuestionEngine implements QuestionEngine {
  propose(event: GameEvent, state: GameState): MarketCandidate[] {
    if (event.type === 'penalty_awarded') {
      const player = event.player ?? 'the taker';
      return [
        {
          templateId: 'soccer.penalty',
          kind: 'moment',
          question: `Will ${player} score this penalty?`,
          hook: `Penalty! ${player} steps up.`,
          outcomes: YES_NO,
          prior: { yes: 0.77, no: 0.23 },
          lockAfterSecs: 45,
          lockOnEvent: 'penalty_result',
          resolver: { type: 'penalty_result', params: { player: event.player } },
          priority: 10,
          rationale: 'Penalties are converted about 77% of the time.',
        },
      ];
    }
    if (event.type === 'kickoff') {
      return [
        {
          templateId: 'soccer.total_goals',
          kind: 'game',
          question: `Will there be 3 or more goals?`,
          hook: 'Goals, goals, goals. Three or more tonight?',
          outcomes: YES_NO,
          prior: { yes: 0.44, no: 0.56 },
          lockOnEvent: 'minute:80',
          resolver: { type: 'total_goals', params: { n: 3 } },
          priority: 5,
          rationale: 'Poisson model with 2.45 expected goals.',
        },
        {
          templateId: 'soccer.winner',
          kind: 'game',
          question: `Who wins: ${state.home.name}, ${state.away.name} or a draw?`,
          hook: 'Pick your winner.',
          outcomes: [
            { id: 'home', label: state.home.name },
            { id: 'draw', label: 'Draw' },
            { id: 'away', label: state.away.name },
          ],
          prior: { home: 0.42, draw: 0.27, away: 0.31 },
          lockOnEvent: 'minute:80',
          resolver: { type: 'match_winner', params: {} },
          geminiHint: { kind: 'moneyline' },
          priority: 6,
        },
      ];
    }
    return [];
  }

  shouldLock(market: Market, event: GameEvent, state: GameState): boolean {
    const on = market.lock.onEvent;
    if (!on) return false;
    if (market.createdAtSeq !== undefined && event.seq <= market.createdAtSeq) return false;
    const [type, arg] = on.split(':');
    if (type === 'minute') return (state.minute ?? 0) >= Number(arg) || event.type === 'final';
    if (event.type === 'final') return true;
    return event.type === type && (arg === undefined || String(event.data.period ?? '') === arg);
  }

  evaluate(market: Market, event: GameEvent, state: GameState): ResolverResult {
    if (market.createdAtSeq !== undefined && event.seq <= market.createdAtSeq) return null;
    switch (market.resolver.type) {
      case 'penalty_result':
        if (event.type === 'penalty_result') return { outcome: event.data.scored ? 'yes' : 'no' };
        if (event.type === 'final') return { void: true, reason: 'penalty result never arrived' };
        return null;
      case 'total_goals': {
        const n = Number(market.resolver.params.n ?? 3);
        const total = state.score.home + state.score.away;
        if (total >= n) return { outcome: 'yes' };
        if (event.type === 'final') return { outcome: 'no' };
        return null;
      }
      case 'match_winner':
        if (event.type !== 'final') return null;
        if (state.score.home > state.score.away) return { outcome: 'home' };
        if (state.score.home < state.score.away) return { outcome: 'away' };
        return { outcome: 'draw' };
      default:
        return event.type === 'final' ? { void: true, reason: `unknown resolver ${market.resolver.type}` } : null;
    }
  }

  reprice(): Record<string, number> | null {
    return null;
  }

  explain(market: Market): string {
    const top = [...market.outcomes].sort((a, b) => (market.price[b.id] ?? 0) - (market.price[a.id] ?? 0))[0];
    return `The room has ${top?.label ?? 'the favorite'} at ${Math.round((market.price[top?.id ?? ''] ?? 0) * 100)} percent.`;
  }
}

/** Ranker without an LLM: highest priority first, template text. */
export class TemplateRanker implements QuestionRanker {
  async rank(candidates: MarketCandidate[], _ctx: RoomContext, maxPicks: number): Promise<RankedPick[]> {
    return candidates
      .map((c, index) => ({ c, index }))
      .sort((a, b) => b.c.priority - a.c.priority)
      .slice(0, maxPicks)
      .map(({ c, index }) => ({ index, question: c.question, hook: c.hook }));
  }
}
