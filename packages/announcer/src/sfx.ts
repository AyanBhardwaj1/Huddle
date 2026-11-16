import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USDC, type AnnouncerEvent, type RoomContext, type SfxName } from '@huddle/shared';
import type { Env } from './log';

/**
 * Stingers (PRD section 7, "Sound effects"). Generated once with ElevenLabs Sound Effects by
 * `scripts/generate-sfx.ts` into `assets/sfx/<name>.mp3` and served at `/audio/sfx-<name>`.
 * When a file is missing the line still carries `sfx`, and clients synthesize a cue themselves.
 */

export const SFX_NAMES: readonly SfxName[] = ['goal_horn', 'crowd_roar', 'lock_buzzer', 'cash_register', 'sad_trombone'];
export const SFX_ID_PREFIX = 'sfx-';

/** Prompts for the Sound Effects API. Short, dry, no music beds, so they sit under the voice. */
export const SFX_PROMPTS: Record<SfxName, { text: string; durationSeconds: number; promptInfluence: number }> = {
  goal_horn: { text: 'Loud stadium goal horn, one long triumphant blast with arena reverb, then a short crowd cheer', durationSeconds: 2.5, promptInfluence: 0.5 },
  crowd_roar: { text: 'Huge football stadium crowd erupting into a roar after a touchdown, cheering and applause', durationSeconds: 3, promptInfluence: 0.5 },
  lock_buzzer: { text: 'Short sharp game-show buzzer, a single harsh electronic buzz marking time is up', durationSeconds: 1, promptInfluence: 0.6 },
  cash_register: { text: 'Classic cash register cha-ching with a bell and coins dropping into the drawer', durationSeconds: 1.5, promptInfluence: 0.6 },
  sad_trombone: { text: 'Comedic sad trombone, four descending wah-wah notes', durationSeconds: 2.5, promptInfluence: 0.6 },
};

/** A single loss this large on one market earns the sad trombone. */
export const BIG_LOSS = 5 * USDC;

const SCORING_WORDS = /\b(goal|score[sd]?|scoring|penalty|free kick|header|net|touchdown|field goal|td|convert|conversion)\b/i;
const NEGATIVE_OUTCOME = /^(no|none|neither|miss(es|ed)?|saved|under|nobody)\b/i;

export function isSfxName(v: string): v is SfxName {
  return (SFX_NAMES as readonly string[]).includes(v);
}

/** Which stinger (if any) goes with an event. Pure, deterministic. */
export function sfxFor(event: AnnouncerEvent, ctx: Pick<RoomContext, 'sport'>): SfxName | undefined {
  switch (event.type) {
    case 'market_locked':
      return 'lock_buzzer';
    case 'game_recap':
      return 'crowd_roar';
    case 'market_resolved': {
      const biggestLoss = Math.max(0, ...event.losers.map((l) => l.amount));
      const biggestWin = Math.max(0, ...event.winners.map((w) => w.amount));
      // Nobody won, or one player's loss dwarfs every win: that is the story.
      if (event.losers.length > 0 && (event.winners.length === 0 || (biggestLoss >= BIG_LOSS && biggestLoss > biggestWin))) {
        return 'sad_trombone';
      }
      const scored =
        SCORING_WORDS.test(`${event.market.question} ${event.market.templateId ?? ''}`) && !NEGATIVE_OUTCOME.test(event.outcomeLabel.trim());
      if (scored) return ctx.sport === 'soccer' ? 'goal_horn' : 'crowd_roar';
      if (event.winners.length > 0) return 'cash_register';
      return 'crowd_roar';
    }
    default:
      return undefined;
  }
}

/** Directory holding the generated stingers. */
export function sfxDir(env: Env = {}): string {
  return env.SFX_DIR?.trim() || join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sfx');
}

export function sfxFile(name: SfxName, env: Env = {}): string {
  return join(sfxDir(env), `${name}.mp3`);
}

/** Serves stinger files with a tiny cache so `getAudio` stays synchronous and cheap. */
export class SfxLibrary {
  private readonly cache = new Map<SfxName, Uint8Array>();

  constructor(private readonly env: Env = {}) {}

  has(name: SfxName): boolean {
    return this.cache.has(name) || existsSync(sfxFile(name, this.env));
  }

  url(name: SfxName): string | undefined {
    return this.has(name) ? `/audio/${SFX_ID_PREFIX}${name}` : undefined;
  }

  /** `id` is `sfx-<name>`. */
  get(id: string): Uint8Array | undefined {
    if (!id.startsWith(SFX_ID_PREFIX)) return undefined;
    const name = id.slice(SFX_ID_PREFIX.length);
    if (!isSfxName(name)) return undefined;
    const hit = this.cache.get(name);
    if (hit) return hit;
    try {
      const data = new Uint8Array(readFileSync(sfxFile(name, this.env)));
      if (!data.byteLength) return undefined;
      this.cache.set(name, data);
      return data;
    } catch {
      return undefined;
    }
  }
}
