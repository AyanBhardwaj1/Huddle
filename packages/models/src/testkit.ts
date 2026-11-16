import { initialGameState, type GameEvent, type GameState, type Market, type MarketCandidate, type QuestionEngine } from '@huddle/shared';
import { reduce, type Timeline } from '@huddle/sports';

/** A market as the party engine would create it from a candidate. Test helper, not used at runtime. */
export function marketFromCandidate(c: MarketCandidate, opts: { id: string; seq?: number; atMs?: number }): Market {
  const base = Date.UTC(2026, 10, 16, 12, 0, 0);
  const atMs = opts.atMs ?? 0;
  const market: Market = {
    id: opts.id,
    partyId: 'party',
    question: c.question,
    kind: c.kind,
    mode: 'pool',
    outcomes: c.outcomes,
    prior: c.prior,
    lock: { manual: true },
    resolver: c.resolver,
    state: 'open',
    createdBy: 'ai',
    price: { ...c.prior },
    volume: 0,
    hook: c.hook,
    templateId: c.templateId,
    createdAt: new Date(base + atMs).toISOString(),
  };
  if (opts.seq !== undefined) market.createdAtSeq = opts.seq;
  if (c.lockAfterSecs !== undefined) market.lock.at = new Date(base + atMs + c.lockAfterSecs * 1000).toISOString();
  if (c.lockOnEvent) market.lock.onEvent = c.lockOnEvent;
  return market;
}

export interface SimMarket {
  market: Market;
  candidate: MarketCandidate;
  openedAtMs: number;
  lockAtMs?: number;
  lockedAtMs?: number;
  lockedBy?: 'countdown' | 'event' | 'resolution';
  resolvedAtMs?: number;
  outcome?: string;
  voidReason?: string;
}

export interface SimResult {
  markets: SimMarket[];
  state: GameState;
  byTemplate(templateId: string): SimMarket[];
}

/**
 * Drive a replay timeline through reduce + the question engine the way the party engine does:
 * for every event: countdown locks, event locks, resolvers, then new proposals (all accepted).
 */
export function simulateReplay(timeline: Timeline, engine: QuestionEngine): SimResult {
  let state = initialGameState(timeline.info.id, timeline.info.sport, timeline.info.home, timeline.info.away);
  const sims: SimMarket[] = [];
  let n = 0;

  for (const { atMs, event } of timeline.events) {
    const e: GameEvent = { ...event, ts: new Date(Date.UTC(2026, 10, 16, 12, 0, 0) + atMs).toISOString() };
    state = reduce(state, e);

    for (const s of sims) {
      if (s.market.state === 'open' && s.lockAtMs !== undefined && s.lockAtMs <= atMs) {
        s.market.state = 'locked';
        s.lockedAtMs = s.lockAtMs;
        s.lockedBy = 'countdown';
      }
    }
    for (const s of sims) {
      if (s.market.state === 'open' && engine.shouldLock(s.market, e, state)) {
        s.market.state = 'locked';
        s.lockedAtMs = atMs;
        s.lockedBy = 'event';
      }
    }
    for (const s of sims) {
      if (s.market.state !== 'open' && s.market.state !== 'locked') continue;
      const r = engine.evaluate(s.market, e, state);
      if (!r) continue;
      if (s.market.state === 'open') {
        s.lockedAtMs = atMs;
        s.lockedBy = 'resolution';
      }
      s.resolvedAtMs = atMs;
      if ('outcome' in r) {
        s.market.state = 'resolved';
        s.market.outcome = r.outcome;
        s.outcome = r.outcome;
      } else {
        s.market.state = 'voided';
        s.market.voidReason = r.reason;
        s.voidReason = r.reason;
      }
    }

    const open = sims.map((s) => s.market).filter((m) => m.state === 'open' || m.state === 'locked');
    for (const c of engine.propose(e, state, open)) {
      const market = marketFromCandidate(c, { id: `m${++n}`, seq: e.seq, atMs });
      sims.push({ market, candidate: c, openedAtMs: atMs, lockAtMs: c.lockAfterSecs !== undefined ? atMs + c.lockAfterSecs * 1000 : undefined });
    }
  }

  return { markets: sims, state, byTemplate: (id) => sims.filter((s) => s.market.templateId === id) };
}
