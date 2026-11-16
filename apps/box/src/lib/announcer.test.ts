import type { AnnouncerLine } from '@huddle/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnouncerPlayer, PERSONA_VOICE } from './announcer';

class FakeUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class FakeAudio {
  static played: string[] = [];
  static fail = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public src: string) {}
  play() {
    if (FakeAudio.fail) return Promise.reject(new Error('blocked'));
    FakeAudio.played.push(this.src);
    setTimeout(() => this.onended?.(), 5);
    return Promise.resolve();
  }
  pause() {}
}

const line = (id: string, p: Partial<AnnouncerLine> = {}): AnnouncerLine => ({
  id,
  text: `line ${id}`,
  priority: 'medium',
  createdAt: new Date().toISOString(),
  event: 'big_trade',
  persona: 'nfl',
  ...p,
});

function setup() {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speak: (u: FakeUtterance) => {
      spoken.push(u);
      setTimeout(() => u.onend?.(), 5);
    },
    cancel: vi.fn(),
    getVoices: () => [],
  };
  vi.stubGlobal('window', { speechSynthesis: synth, location: { origin: 'http://box.test' } });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('Audio', FakeAudio);
  FakeAudio.played = [];
  FakeAudio.fail = false;
  const changes: (string | null)[] = [];
  const player = new AnnouncerPlayer((l) => changes.push(l?.id ?? null));
  return { player, spoken, synth, changes };
}

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

afterEach(() => vi.unstubAllGlobals());

describe('AnnouncerPlayer', () => {
  it('is silent until sound is enabled', async () => {
    const { player, spoken } = setup();
    player.push(line('a'));
    await tick();
    expect(spoken).toHaveLength(0);
  });

  it('speaks text with the persona voice when there is no audio URL', async () => {
    const { player, spoken, changes } = setup();
    player.setEnabled(true);
    player.push(line('a'));
    await tick();
    expect(spoken[0]).toMatchObject({ text: 'line a', rate: PERSONA_VOICE.nfl.rate, pitch: PERSONA_VOICE.nfl.pitch, lang: 'en-US' });
    expect(changes).toEqual(['a', null]);
  });

  it('plays the engine audio URL, falling back to speech when it fails', async () => {
    const { player, spoken } = setup();
    player.setEnabled(true);
    player.push(line('a', { audioUrl: '/audio/abc' }));
    await tick();
    expect(FakeAudio.played).toEqual(['http://box.test/audio/abc']);
    expect(spoken).toHaveLength(0);
    FakeAudio.fail = true;
    player.push(line('b', { audioUrl: '/audio/def' }));
    await tick();
    expect(spoken.map((u) => u.text)).toEqual(['line b']);
  });

  it('lets a high-priority line preempt a medium one', async () => {
    const { player, synth, changes } = setup();
    // make speech hang until cancelled
    synth.speak = () => {};
    player.setEnabled(true);
    player.push(line('m'));
    await tick(5);
    player.push(line('h', { priority: 'high' }));
    await tick(5);
    expect(synth.cancel).toHaveBeenCalled();
    expect(changes.slice(0, 2)).toEqual(['m', 'h']);
  });
});
