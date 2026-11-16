import type { Fill, Market, Persona, Scorecard } from './types';

export type AnnouncerPriority = 'high' | 'medium' | 'low';

/** Events the engine emits for the announcer (PRD section 7). */
export type AnnouncerEvent =
  | { type: 'market_opened'; market: Market; lockInSecs?: number }
  | { type: 'lock_soon'; market: Market; secondsLeft: number }
  | { type: 'market_locked'; market: Market }
  | { type: 'big_trade'; market: Market; fill: Fill; outcomeLabel: string }
  | {
      type: 'market_resolved';
      market: Market;
      outcomeLabel: string;
      winners: { name: string; amount: number }[];
      losers: { name: string; amount: number }[];
    }
  | { type: 'market_voided'; market: Market; reason?: string }
  | { type: 'player_joined'; name: string; amount: number; remote: boolean; city?: string }
  | { type: 'leaderboard_change'; leader: string; pnl: number }
  | {
      type: 'game_recap';
      scorecard: Scorecard;
      leaderboard: { name: string; pnl: number }[];
      biggestSwing?: { name: string; amount: number; question: string };
      finalScore: string;
    }
  | { type: 'talk_reply'; text: string };

export type AnnouncerEventType = AnnouncerEvent['type'];

export const ANNOUNCER_PRIORITY: Record<AnnouncerEventType, AnnouncerPriority> = {
  market_opened: 'high',
  lock_soon: 'high',
  market_locked: 'medium',
  big_trade: 'medium',
  market_resolved: 'high',
  market_voided: 'medium',
  player_joined: 'low',
  leaderboard_change: 'low',
  game_recap: 'high',
  talk_reply: 'high',
};

export type SfxName = 'goal_horn' | 'crowd_roar' | 'lock_buzzer' | 'cash_register' | 'sad_trombone';

/** One spoken line, also shown as a caption on every screen. */
export interface AnnouncerLine {
  id: string;
  text: string;
  /** Path or URL of generated audio. Absent -> the client speaks `text` with the Web Speech API. */
  audioUrl?: string;
  priority: AnnouncerPriority;
  createdAt: string;
  event: AnnouncerEventType;
  marketId?: string;
  persona: Persona;
  /** Optional stinger to play before the line. */
  sfx?: SfxName;
  sfxUrl?: string;
}

/** Room context handed to the LLM and the line templates. Every number the announcer may say is in here. */
export interface RoomContext {
  partyName: string;
  persona: Persona;
  sport: 'soccer' | 'nfl';
  points: boolean;
  score: string;
  clock: string;
  home: string;
  away: string;
  leaderboard: { name: string; pnl: number; streak?: number }[];
  recentResults: { question: string; outcome: string }[];
}

/** TALK button fallback / agent tool context. */
export interface TalkContext extends RoomContext {
  speaker?: { pubkey: string; name: string; balance: number };
  markets: Market[];
}

export interface TalkReply {
  text: string;
  /** A draft bet the player must confirm in the app. The voice path never moves money. */
  draft?: { marketId: string; outcome: string; amount: number };
}

const RANK: Record<AnnouncerPriority, number> = { high: 3, medium: 2, low: 1 };
export const STALE_LOW_PRIORITY_MS = 6000;

/**
 * Playback queue (PRD section 7): one speaking line at a time; high priority preempts lower ones;
 * stale non-high lines older than 6 s are dropped. Framework-free; the UI supplies `play` and `stop`.
 */
export class AnnouncerQueue {
  private queue: AnnouncerLine[] = [];
  private current: AnnouncerLine | null = null;

  constructor(
    private readonly io: {
      /** Start playing; resolve when playback ends (or fails). */
      play: (line: AnnouncerLine) => Promise<void>;
      /** Stop the line that is currently playing. */
      stop: () => void;
      now?: () => number;
      onChange?: (current: AnnouncerLine | null) => void;
    },
  ) {}

  get speaking(): AnnouncerLine | null {
    return this.current;
  }

  get pending(): readonly AnnouncerLine[] {
    return this.queue;
  }

  push(line: AnnouncerLine): void {
    if (this.current && line.priority === 'high' && this.current.priority !== 'high') {
      // Preempt: the interrupted line is dropped, not replayed.
      this.queue.unshift(line);
      this.io.stop();
      return;
    }
    this.queue.push(line);
    this.queue.sort((a, b) => RANK[b.priority] - RANK[a.priority] || a.createdAt.localeCompare(b.createdAt));
    if (!this.current) void this.pump();
  }

  clear(): void {
    this.queue = [];
    if (this.current) this.io.stop();
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const now = this.io.now?.() ?? Date.now();
    this.queue = this.queue.filter(
      (l) => l.priority === 'high' || now - Date.parse(l.createdAt) <= STALE_LOW_PRIORITY_MS,
    );
    const next = this.queue.shift();
    if (!next) {
      this.io.onChange?.(null);
      return;
    }
    this.current = next;
    this.io.onChange?.(next);
    try {
      await this.io.play(next);
    } catch {
      /* playback errors never stall the queue */
    }
    this.current = null;
    void this.pump();
  }
}
