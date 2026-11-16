import { AnnouncerQueue, type AnnouncerLine } from '@huddle/shared';
import { engineUrl } from './config';

/**
 * Announcer playback for the phone (PRD section 7, P1): one shared <audio> element (so iOS keeps
 * the autoplay unlock from the first tap), Web Speech when a line has no audio URL.
 */

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=';

let el: HTMLAudioElement | null = null;
function audioEl(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
  }
  return el;
}

let unlocked = false;
/** Call from a user gesture (tap) so later programmatic playback is allowed on iOS. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  try {
    const a = audioEl();
    a.src = SILENT_WAV;
    void a.play().catch(() => {
      unlocked = false;
    });
  } catch {
    unlocked = false;
  }
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  } catch {
    /* no speech */
  }
}

function playUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const a = audioEl();
    const done = () => {
      a.onended = null;
      a.onerror = null;
      a.onpause = null;
      resolve();
    };
    a.onended = done;
    a.onerror = done;
    a.onpause = done;
    a.src = engineUrl(url);
    a.play().catch(done);
  });
}

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.08;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
    // Safari sometimes never fires onend.
    setTimeout(resolve, Math.min(15_000, 1500 + text.length * 70));
  });
}

async function playLine(line: AnnouncerLine): Promise<void> {
  if (line.sfxUrl) await playUrl(line.sfxUrl);
  if (line.audioUrl) await playUrl(line.audioUrl);
  else await speak(line.text);
}

function stopAll(): void {
  try {
    el?.pause();
  } catch {
    /* ignore */
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

export function createAnnouncerQueue(now: () => number, onChange?: (l: AnnouncerLine | null) => void): AnnouncerQueue {
  return new AnnouncerQueue({ play: playLine, stop: stopAll, now, onChange });
}

export function stopAnnouncer(): void {
  stopAll();
}
