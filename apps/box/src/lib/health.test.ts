import { describe, expect, it } from 'vitest';
import { healthChips, providerName } from './health';
import { loadSession, saveSession } from './session';

describe('health chips', () => {
  it('reads string and object provider values', () => {
    expect(providerName('ElevenLabs')).toBe('elevenlabs');
    expect(providerName({ name: 'replay' })).toBe('replay');
    expect(providerName({ live: false })).toBe('mock');
    expect(providerName(undefined)).toBeNull();
  });

  it('shows replay, points, Gemini and a Web Speech warning', () => {
    const chips = healthChips({
      ok: true,
      settlement: 'points',
      providers: { sports: 'replay', gemini: 'live', announcer: 'webspeech', llm: 'mock' },
    });
    expect(chips.map((c) => c.label)).toEqual([
      'Engine ready',
      'Replay mode',
      'Points only',
      'Gemini: live',
      'Voice: Web Speech fallback',
      'AI lines: templates',
    ]);
    expect(chips.find((c) => c.id === 'voice')).toMatchObject({ tone: 'warn' });
  });

  it('shows ElevenLabs without a warning and flags an offline engine', () => {
    const chips = healthChips({ ok: true, settlement: { mode: 'vault' }, providers: { announcer: { provider: 'elevenlabs' } } });
    expect(chips.find((c) => c.id === 'voice')).toMatchObject({ label: 'Voice: ElevenLabs', tone: 'ok' });
    expect(chips.find((c) => c.id === 'settlement')?.label).toBe('Vault · test money');
    expect(healthChips(null, true)).toEqual([expect.objectContaining({ label: 'Engine offline', tone: 'warn' })]);
  });
});

describe('session persistence', () => {
  it('round-trips and rejects junk', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    expect(loadSession(storage)).toBeNull();
    saveSession({ partyCode: 'KICK', hostToken: 'secret' }, storage);
    expect(loadSession(storage)).toEqual({ partyCode: 'KICK', hostToken: 'secret' });
    mem.set('huddle.box.session', '{"partyCode":1}');
    expect(loadSession(storage)).toBeNull();
    mem.set('huddle.box.session', 'not json');
    expect(loadSession(storage)).toBeNull();
    saveSession(null, storage);
    expect(mem.size).toBe(0);
  });
});
