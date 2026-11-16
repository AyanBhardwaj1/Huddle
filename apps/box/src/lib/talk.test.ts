import type { ClientRequest } from '@huddle/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TalkController, type TalkState } from './talk';

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: ((e: { results: { 0: { transcript: string }; isFinal: boolean; length: number }[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    setTimeout(() => this.onend?.(), 5);
  }
  say(text: string) {
    this.onresult?.({ results: [{ 0: { transcript: text }, isFinal: true, length: 1 }] });
  }
}

function setup(win: Record<string, unknown>) {
  vi.stubGlobal('window', win);
  const sent: ClientRequest[] = [];
  const states: TalkState[] = [];
  const getAgent = vi.fn(async () => null);
  const c = new TalkController({
    partyCode: 'KICK',
    request: async (b) => {
      sent.push(b);
      return {};
    },
    getAgent,
    onState: (s) => states.push(s),
  });
  return { c, sent, states, getAgent };
}

afterEach(() => vi.unstubAllGlobals());

describe('TalkController', () => {
  it('uses SpeechRecognition and sends talk_text on release', async () => {
    const { c, sent, states, getAgent } = setup({ webkitSpeechRecognition: FakeRecognition });
    await c.press();
    expect(states.at(-1)).toMatchObject({ phase: 'listening', mode: 'speech' });
    expect(FakeRecognition.last?.started).toBe(true);
    FakeRecognition.last!.say('what are the odds Portugal hits seven');
    await c.release();
    expect(sent.map((s) => s.type)).toEqual(['talk_start', 'talk_end', 'talk_text']);
    expect(sent.at(-1)).toEqual({ type: 'talk_text', text: 'what are the odds Portugal hits seven' });
    expect(states.at(-1)?.phase).toBe('idle');
    // agent lookup is cached per party
    await c.press();
    await c.release();
    expect(getAgent).toHaveBeenCalledTimes(1);
  });

  it('falls back to a text box without speech recognition', async () => {
    const { c, sent, states } = setup({});
    await c.press();
    await c.release();
    expect(states.at(-1)).toMatchObject({ phase: 'text', mode: 'text' });
    await c.sendText('  who is winning?  ');
    expect(sent.at(-1)).toEqual({ type: 'talk_text', text: 'who is winning?' });
    expect(states.at(-1)?.phase).toBe('idle');
  });

  it('reports an empty transcript instead of sending', async () => {
    const { c, sent, states } = setup({ SpeechRecognition: FakeRecognition });
    await c.press();
    await c.release();
    expect(sent.some((s) => s.type === 'talk_text')).toBe(false);
    expect(states.at(-1)).toMatchObject({ phase: 'idle', error: "Didn't catch that" });
  });
});
