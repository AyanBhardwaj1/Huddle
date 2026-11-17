import { describe, expect, it } from 'vitest';
import { engineIsLocal, healthChips, providerName } from './health';
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

describe('hosted vs local engine', () => {
  it('tells local engines from hosted ones', () => {
    expect(engineIsLocal('http://localhost:8080')).toBe(true);
    expect(engineIsLocal('http://192.168.1.20:8080')).toBe(true);
    expect(engineIsLocal('https://huddle-engine-p1fc.onrender.com')).toBe(false);
  });

  it('only suggests port 8080 when the engine is local', () => {
    expect(healthChips(null, true, true)[0]!.hint).toContain('port 8080');
    const hosted = healthChips(null, true, false)[0]!;
    expect(hosted.label).toBe('Engine offline');
    expect(hosted.hint).not.toContain('8080');
    expect(hosted.hint).toContain('waking up');
  });
});
});
