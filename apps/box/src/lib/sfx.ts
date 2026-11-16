import type { SfxName } from '@huddle/shared';

/**
 * Stingers (PRD section 7 sound effects). Plays `sfxUrl` when the engine has a generated file,
 * otherwise synthesizes a short cue with the Web Audio API so it works offline with no assets.
 */

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Call from a user gesture. Resolves true when audio output is allowed. */
export async function unlockAudio(): Promise<boolean> {
  const c = audioContext();
  if (!c) return false;
  try {
    await c.resume();
  } catch {}
  // Prime speech synthesis inside the gesture too (Safari/Chromium autoplay rules).
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis?.speak(u);
  } catch {}
  return c.state === 'running';
}

/** True when the browser already allows audio without a gesture (e.g. kiosk autoplay flag). */
export function audioAlreadyAllowed(): boolean {
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
  if (nav.userActivation?.hasBeenActive) return true;
  try {
    const c = audioContext();
    return c?.state === 'running';
  } catch {
    return false;
  }
}

function env(g: GainNode, t0: number, attack: number, hold: number, release: number, peak: number) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
}

function tone(c: AudioContext, out: AudioNode, type: OscillatorType, freq: number, t0: number, dur: number, peak: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  env(g, t0, 0.02, Math.max(0, dur - 0.12), 0.1, peak);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  return o;
}

function noise(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

/** Synthesize a cue; resolves when it has finished. Returns the duration in seconds. */
export function synthSfx(name: SfxName): Promise<void> {
  const c = audioContext();
  if (!c || c.state !== 'running') return Promise.resolve();
  const out = c.createGain();
  out.gain.value = 0.5;
  out.connect(c.destination);
  const t = c.currentTime + 0.02;
  let dur = 1;
  switch (name) {
    case 'goal_horn': {
      dur = 1.6;
      for (const f of [146.8, 185, 220]) {
        const o = tone(c, out, 'sawtooth', f, t, dur, 0.18);
        const lfo = c.createOscillator();
        const lg = c.createGain();
        lfo.frequency.value = 5;
        lg.gain.value = 2.5;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + dur);
      }
      break;
    }
    case 'crowd_roar': {
      dur = 2;
      const n = noise(c, dur);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(600, t);
      bp.frequency.linearRampToValueAtTime(1400, t + dur * 0.6);
      bp.Q.value = 0.7;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(bp).connect(g).connect(out);
      n.start(t);
      break;
    }
    case 'lock_buzzer': {
      dur = 0.55;
      tone(c, out, 'square', 110, t, dur, 0.25);
      tone(c, out, 'square', 116, t, dur, 0.18);
      break;
    }
    case 'cash_register': {
      dur = 0.9;
      const click = noise(c, 0.05);
      const g = c.createGain();
      env(g, t, 0.002, 0.01, 0.04, 0.6);
      click.connect(g).connect(out);
      click.start(t);
      tone(c, out, 'sine', 1318.5, t + 0.06, 0.35, 0.3);
      tone(c, out, 'sine', 1975.5, t + 0.16, 0.7, 0.25);
      break;
    }
    case 'sad_trombone': {
      const notes = [293.7, 277.2, 261.6, 246.9];
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      lp.connect(out);
      notes.forEach((f, i) => {
        const last = i === notes.length - 1;
        const o = tone(c, lp, 'sawtooth', f, t + i * 0.42, last ? 1.1 : 0.38, 0.22);
        if (last) {
          const lfo = c.createOscillator();
          const lg = c.createGain();
          lfo.frequency.value = 6;
          lg.gain.value = 6;
          lfo.connect(lg).connect(o.frequency);
          lfo.start(t + i * 0.42);
          lfo.stop(t + i * 0.42 + 1.1);
        }
      });
      dur = 0.42 * 3 + 1.1;
      break;
    }
  }
  return new Promise((r) => setTimeout(r, dur * 1000 + 60));
}

/** Play a stinger: engine file when present, synthesized fallback otherwise. */
export function playSfx(name: SfxName, url?: string): Promise<void> {
  if (!url) return synthSfx(name);
  return new Promise((resolve) => {
    const a = new Audio(url);
    const done = () => resolve();
    a.onended = done;
    a.onerror = () => void synthSfx(name).then(done);
    a.play().catch(() => void synthSfx(name).then(done));
    setTimeout(done, 4000);
  });
}
