import {
  ANNOUNCER_PRIORITY,
  type AnnouncerEvent,
  type AnnouncerLine,
  type RoomContext,
  type TalkContext,
  type TalkReply,
} from '../announcer';
import type { BridgeCommand, BridgeEvent } from '../bridge';
import type { Announcer, BoxBridge, GeminiClient, LlmClient, MarketCandidate } from '../interfaces';
import { formatPct, formatUsd } from '../odds';
import { randomId } from '../state';
import type { GameInfo, GeminiPanel, GeminiRef, Outcome, Persona } from '../types';

// ───────────── Gemini ─────────────

/** Offline Gemini: a plausible moneyline for whatever game is asked for. */
export class MockGeminiClient implements GeminiClient {
  readonly source = 'mock' as const;

  async matchGame(game: GameInfo): Promise<GeminiPanel> {
    const asOf = new Date().toISOString();
    const ticker = `MOCK-${game.home.short}-${game.away.short}-M`;
    return {
      available: true,
      source: 'mock',
      note: 'Offline sample odds (Gemini mock)',
      asOf,
      events: [
        {
          eventTicker: ticker,
          title: `${game.home.name} vs ${game.away.name}`,
          kind: 'moneyline',
          contracts: [
            { eventTicker: ticker, contractTicker: `${ticker}-${game.home.short}`, label: game.home.name, prob: 0.46, bestBid: 0.45, bestAsk: 0.47, source: 'mid', asOf },
            { eventTicker: ticker, contractTicker: `${ticker}-${game.away.short}`, label: game.away.name, prob: 0.29, bestBid: 0.28, bestAsk: 0.3, source: 'mid', asOf },
          ],
        },
      ],
    };
  }

  async refresh(panel: GeminiPanel): Promise<GeminiPanel> {
    return { ...panel, asOf: new Date().toISOString() };
  }

  refFor(panel: GeminiPanel, hint: MarketCandidate['geminiHint'], outcomes: Outcome[], game: GameInfo): GeminiRef | undefined {
    if (!hint || !panel.available) return undefined;
    const ev = panel.events.find((e) => e.kind === hint.kind);
    if (!ev) return undefined;
    for (const c of ev.contracts) {
      if (c.prob === null) continue;
      const outcome = outcomes.find(
        (o) => o.label === c.label || (o.id === 'home' && c.label === game.home.name) || (o.id === 'away' && c.label === game.away.name),
      );
      if (outcome) {
        return { eventTicker: ev.eventTicker, contractTicker: c.contractTicker, prob: c.prob, asOf: c.asOf, outcomeId: outcome.id, label: c.label };
      }
    }
    return undefined;
  }
}

// ───────────── LLM ─────────────

export class MockLlmClient implements LlmClient {
  readonly available = false;
  async completeJson(): Promise<unknown | null> {
    return null;
  }
}

// ───────────── Announcer ─────────────

/** Template lines for every announcer event. No numbers are invented: all come from the event. */
export function templateLine(event: AnnouncerEvent, ctx: RoomContext): string | null {
  const money = (n: number): string => formatUsd(n, { points: ctx.points });
  switch (event.type) {
    case 'market_opened': {
      const m = event.market;
      const top = [...m.outcomes].sort((a, b) => (m.price[b.id] ?? 0) - (m.price[a.id] ?? 0))[0]!;
      const lock = event.lockInSecs ? ` ${event.lockInSecs} seconds, get in!` : '';
      return `${m.hook ?? m.question} Room's got ${top.label} at ${formatPct(m.price[top.id] ?? 0)}.${lock}`;
    }
    case 'lock_soon':
      return `${event.secondsLeft} seconds! Last call!`;
    case 'market_locked':
      return 'Locked!';
    case 'big_trade':
      return `${event.fill.playerName} just put ${money(event.fill.amount)} on ${event.outcomeLabel}. Bold.`;
    case 'market_resolved': {
      const w = event.winners[0];
      const l = event.losers[0];
      let s = `It's ${event.outcomeLabel}!`;
      if (w) s += ` ${w.name} takes ${money(w.amount)}.`;
      if (l) s += ` ${l.name}, you're cooked.`;
      return s;
    }
    case 'market_voided':
      return 'That one is off. Everyone gets their money back.';
    case 'player_joined':
      return `${event.name}'s in for ${money(event.amount)}${event.city ? ` from ${event.city}` : ''}!`;
    case 'leaderboard_change':
      return `New leader: ${event.leader}, up ${money(event.pnl)}.`;
    case 'game_recap': {
      const top = event.leaderboard[0];
      return `Full time, ${event.finalScore}. ${top ? `${top.name} wins the night, up ${money(top.pnl)}. ` : ''}${event.scorecard.verdict}`;
    }
    case 'talk_reply':
      return event.text;
  }
}

/** Text-only announcer: clients speak the line with the Web Speech API. */
export class MockAnnouncer implements Announcer {
  readonly provider = 'webspeech' as const;
  private persona: Persona = 'soccer';

  async warmup(persona: Persona): Promise<void> {
    this.persona = persona;
  }

  async announce(event: AnnouncerEvent, ctx: RoomContext): Promise<AnnouncerLine | null> {
    const text = templateLine(event, ctx);
    if (!text) return null;
    return {
      id: randomId(6),
      text,
      priority: ANNOUNCER_PRIORITY[event.type],
      createdAt: new Date().toISOString(),
      event: event.type,
      marketId: 'market' in event ? event.market.id : undefined,
      persona: ctx.persona ?? this.persona,
    };
  }

  getAudio(): undefined {
    return undefined;
  }

  async answer(text: string, ctx: TalkContext): Promise<TalkReply> {
    const open = ctx.markets.filter((m) => m.state === 'open');
    const m = open[0];
    if (!m) return { text: 'Nothing is open right now. Sit tight.' };
    const top = [...m.outcomes].sort((a, b) => (m.price[b.id] ?? 0) - (m.price[a.id] ?? 0))[0]!;
    const bet = /(\d+(?:\.\d+)?)\s*(?:dollars|bucks|usdc|points)?\s*on\s+(\w+)/i.exec(text);
    if (bet) {
      const outcome = m.outcomes.find((o) => o.label.toLowerCase() === bet[2]!.toLowerCase() || o.id === bet[2]!.toLowerCase());
      if (outcome) {
        return {
          text: `Drafted ${bet[1]} on ${outcome.label}. Confirm it in the app.`,
          draft: { marketId: m.id, outcome: outcome.id, amount: Math.round(Number(bet[1]) * 1_000_000) },
        };
      }
    }
    return { text: `${m.question} The room has ${top.label} at ${formatPct(m.price[top.id] ?? 0)}.` };
  }
}

// ───────────── Box bridge ─────────────

/** In-process bridge: records commands, lets tests press buttons. */
export class MockBoxBridge implements BoxBridge {
  readonly connected = true;
  readonly commands: BridgeCommand[] = [];
  private listeners = new Set<(e: BridgeEvent) => void>();

  send(cmd: BridgeCommand): void {
    this.commands.push(cmd);
  }
  onEvent(cb: (e: BridgeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  /** Test helper: simulate a hardware event. */
  emit(e: BridgeEvent): void {
    this.listeners.forEach((l) => l(e));
  }
  press(id: 'lock' | 'talk' | 'next'): void {
    this.emit({ type: 'button', id, action: 'down' });
    this.emit({ type: 'button', id, action: 'up' });
  }
  close(): void {
    this.listeners.clear();
  }
}
