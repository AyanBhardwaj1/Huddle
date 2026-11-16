import { AnnouncerQueue, type AnnouncerLine, type Persona } from '@huddle/shared';
import { engineUrl } from './config';
import { playSfx } from './sfx';

/** Web Speech voice settings per persona (fallback when the engine has no ElevenLabs audio). */
export const PERSONA_VOICE: Record<Persona, { lang: string; rate: number; pitch: number }> = {
  soccer: { lang: 'en-GB', rate: 1.12, pitch: 1.05 },
  nfl: { lang: 'en-US', rate: 1.06, pitch: 0.82 },
  calm: { lang: 'en-US', rate: 0.94, pitch: 1.0 },
};

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const exact = voices.filter((v) => v.lang === lang || v.lang.replace('_', '-') === lang);
  const loose = voices.filter((v) => v.lang.startsWith(lang.slice(0, 2)));
  const pool = exact.length ? exact : loose;
  // Prefer the higher-quality network/neural voices when the platform offers them.
  return pool.find((v) => /natural|neural|google|premium|enhanced/i.test(v.name)) ?? pool[0];
}

/**
 * Box speaker playback: an `AnnouncerQueue` (one line at a time, high preempts, stale lows dropped)
 * playing the line's stinger then its `audioUrl` through an <audio> element, or speaking `text` with
 * speechSynthesis when there is no audio (or it fails to load).
 */
export class AnnouncerPlayer {
  private queue: AnnouncerQueue;
  private audio: HTMLAudioElement | null = null;
  private finish: (() => void) | null = null;
  private enabled = false;

  constructor(onChange: (line: AnnouncerLine | null) => void) {
    this.queue = new AnnouncerQueue({
      play: (line) => this.play(line),
      stop: () => this.stopCurrent(),
      onChange,
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.queue.clear();
  }

  push(line: AnnouncerLine): void {
    if (this.enabled) this.queue.push(line);
  }

  /** Stop whatever is speaking (e.g. TALK pressed). Queued lines continue afterwards. */
  interrupt(): void {
    this.stopCurrent();
  }

  dispose(): void {
    this.queue.clear();
    this.stopCurrent();
  }

  private stopCurrent(): void {
    this.audio?.pause();
    this.audio = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {}
    this.finish?.();
    this.finish = null;
  }

  private async play(line: AnnouncerLine): Promise<void> {
    let stopped = false;
    const stopGate = new Promise<void>((r) => {
      this.finish = () => {
        stopped = true;
        r();
      };
    });
    if (line.sfx) {
      await Promise.race([playSfx(line.sfx, line.sfxUrl ? engineUrl(line.sfxUrl) : undefined), stopGate]);
      if (stopped) return;
    }
    const spoken = line.audioUrl ? this.playUrl(engineUrl(line.audioUrl)) : Promise.resolve(false);
    const ok = await Promise.race([spoken, stopGate.then(() => true)]);
    if (stopped) return;
    if (!ok) await Promise.race([this.speak(line), stopGate]);
    this.finish = null;
  }

  /** Resolves true when the file played to the end, false when it could not play. */
  private playUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const a = new Audio(url);
      this.audio = a;
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        resolve(ok);
      };
      const guard = setTimeout(() => done(true), 30_000);
      a.onended = () => done(true);
      a.onerror = () => done(false);
      a.play().catch(() => done(false));
    });
  }

  private speak(line: AnnouncerLine): Promise<void> {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
      const v = PERSONA_VOICE[line.persona] ?? PERSONA_VOICE.soccer;
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = v.lang;
      u.rate = v.rate;
      u.pitch = v.pitch;
      const voice = pickVoice(v.lang);
      if (voice) u.voice = voice;
      // Guard against engines that never fire onend (long text ≈ 15 chars/s).
      const guard = setTimeout(resolve, 3000 + (line.text.length / 12) * 1000);
      u.onend = u.onerror = () => {
        clearTimeout(guard);
        resolve();
      };
      synth.speak(u);
    });
  }
}
