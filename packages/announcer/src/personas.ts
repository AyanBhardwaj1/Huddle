import type { Persona } from '@huddle/shared';
import type { Env } from './log';

/**
 * Announcer personas (PRD section 7). Voices are stock voices from the ElevenLabs default voice
 * library: never a cloned voice and never a real commentator or celebrity. Override per persona with
 * `ELEVENLABS_VOICE_SOCCER` / `_NFL` / `_CALM`.
 */
export interface PersonaConfig {
  label: string;
  /** Style guide for the `announcer_lines` prompt and the voice agent prompt. */
  style: string;
  envVar: string;
  defaultVoiceId: string;
  defaultVoiceName: string;
  voiceSettings: { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean; speed: number };
}

export const PERSONAS: Record<Persona, PersonaConfig> = {
  soccer: {
    label: 'Soccer',
    style:
      'An energetic European-style football commentator: quick, musical, builds excitement, short punchy bursts, ' +
      'loves a dramatic pause. Says "football", "the room", "what a moment". Warm, never mean.',
    envVar: 'ELEVENLABS_VOICE_SOCCER',
    // "George": warm British narrator from the default voice library (the voice used in the official API examples).
    defaultVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
    defaultVoiceName: 'George',
    voiceSettings: { stability: 0.35, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 1.08 },
  },
  nfl: {
    label: 'NFL',
    style:
      'A big-voice American play-by-play announcer: confident, booming, clipped sentences, stadium energy. ' +
      'Says "folks", "on the clock", "big-time play". Friendly swagger, never mean.',
    envVar: 'ELEVENLABS_VOICE_NFL',
    // "Brian": deep American voice from the default voice library.
    defaultVoiceId: 'nPczCjzI2devNBz1zQrb',
    defaultVoiceName: 'Brian',
    voiceSettings: { stability: 0.45, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 1.02 },
  },
  calm: {
    label: 'Calm',
    style:
      'A low-key late-night host: relaxed, dry, quiet confidence, short sentences, no shouting and no exclamation marks. ' +
      'Understated humour.',
    envVar: 'ELEVENLABS_VOICE_CALM',
    // "Eric": smooth, relaxed American voice (the ElevenLabs Agents default voice id).
    defaultVoiceId: 'cjVigY5qzO86Huf0OWal',
    defaultVoiceName: 'Eric',
    voiceSettings: { stability: 0.7, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.96 },
  },
};

export const PERSONA_IDS = Object.keys(PERSONAS) as Persona[];

export function isPersona(v: unknown): v is Persona {
  return typeof v === 'string' && v in PERSONAS;
}

export function voiceIdFor(persona: Persona, env: Env): string {
  const cfg = PERSONAS[persona] ?? PERSONAS.soccer;
  return env[cfg.envVar]?.trim() || cfg.defaultVoiceId;
}
