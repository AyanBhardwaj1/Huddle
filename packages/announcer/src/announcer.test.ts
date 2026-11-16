import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANNOUNCER_PRIORITY, USDC, type AnnouncerEvent, type LlmClient } from '@huddle/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HuddleAnnouncer } from './announcer';
import { createAnnouncer } from './index';
import { sleep, type Env, type FetchLike } from './log';
import { speakable } from './numbers';
import { PERSONAS } from './personas';
import { warmupLines } from './templates';
import { FAKE_MP3, allEvents, audioResponse, corners, fill, jsonResponse, penalty, recordingLogger, room } from './test/fixtures';
import { DEFAULT_TTS_MODEL, Limiter, audioId } from './tts';

const KEY = 'xi-test-key-1234567890';
const offline: LlmClient = { available: false, completeJson: async () => null };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'huddle-announcer-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function env(over: Env = {}): Env {
  return { ELEVENLABS_API_KEY: KEY, DATA_DIR: dir, SFX_DIR: join(dir, 'sfx'), ...over };
}

function make(e: Env, fetch: FetchLike, llm: LlmClient = offline) {
  const log = recordingLogger();
  const announcer = new HuddleAnnouncer(e, llm, { fetch, log });
  return { announcer, log };
}

const opened: AnnouncerEvent = { type: 'market_opened', market: penalty, lockInSecs: 20 };
const lockSoon: AnnouncerEvent = { type: 'lock_soon', market: penalty, secondsLeft: 5 };

describe('announcer with no keys (Web Speech fallback)', () => {
  it('produces a caption line for every event, with no audio and exactly one warning', async () => {
    const fetch = vi.fn<FetchLike>();
    const { announcer, log } = make({ DATA_DIR: dir, SFX_DIR: join(dir, 'sfx') }, fetch);
    expect(announcer.provider).toBe('webspeech');
    await announcer.warmup('soccer');
    for (const event of allEvents()) {
      const line = await announcer.announce(event, room());
      expect(line, event.type).not.toBeNull();
      expect(line!.text.length).toBeGreaterThan(3);
      expect(line!.audioUrl).toBeUndefined();
      expect(line!.event).toBe(event.type);
      expect(line!.priority).toBe(ANNOUNCER_PRIORITY[event.type]);
      expect(line!.persona).toBe('soccer');
      expect(Date.parse(line!.createdAt)).not.toBeNaN();
      if ('market' in event) expect(line!.marketId).toBe(event.market.id);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(log.warns).toHaveLength(1);
    expect(log.warns[0]).toMatch(/ELEVENLABS_API_KEY is not set.*Web Speech/);
    expect(announcer.lastWarning).toMatch(/Web Speech/);
    expect(announcer.getAudio('deadbeefdeadbeefdeadbeefdeadbeef')).toBeUndefined();
    expect(await announcer.agentSession({ partyCode: 'ABCD', sessionToken: 't' })).toBeNull();
  });

  it('is what createAnnouncer returns by default, and is deterministic', async () => {
    const a = createAnnouncer({ DATA_DIR: dir }, offline, { log: recordingLogger() });
    const one = await a.announce(opened, room());
    const two = await a.announce(opened, room());
    expect(one!.text).toBe(two!.text);
    expect(one!.id).not.toBe(two!.id);
    expect(one!.text).toContain('77%');
  });

  it('returns null when there is nothing worth saying, and follows the persona in the context', async () => {
    const { announcer } = make({ DATA_DIR: dir }, vi.fn<FetchLike>());
    expect(await announcer.announce({ type: 'big_trade', market: penalty, fill: fill({ kind: 'refund' }), outcomeLabel: 'No' }, room())).toBeNull();
    expect(await announcer.announce({ type: 'talk_reply', text: '' }, room())).toBeNull();
    const calm = await announcer.announce({ type: 'market_locked', market: penalty }, room({ persona: 'calm' }));
    expect(calm!.persona).toBe('calm');
    expect(calm!.text).not.toContain('!');
  });
});

describe('ElevenLabs text to speech (mocked fetch)', () => {
  it('synthesizes on a cache miss with the streaming endpoint, then serves the clip', async () => {
    const fetch = vi.fn<FetchLike>(async () => audioResponse());
    const { announcer, log } = make(env(), fetch);
    expect(announcer.provider).toBe('elevenlabs');
    const line = await announcer.announce(opened, room());
    expect(line!.audioUrl).toMatch(/^\/audio\/[a-f0-9]{32}$/);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${PERSONAS.soccer.defaultVoiceId}/stream?output_format=mp3_44100_128`);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['xi-api-key']).toBe(KEY);
    const body = JSON.parse(init?.body as string) as { text: string; model_id: string; voice_settings: Record<string, unknown> };
    expect(body.model_id).toBe(DEFAULT_TTS_MODEL);
    // The model gets speakable text; the caption keeps the symbols.
    expect(line!.text).toContain('77%');
    expect(body.text).toBe(speakable(line!.text));
    expect(body.text).toContain('77 percent');
    expect(body.voice_settings).toEqual(PERSONAS.soccer.voiceSettings);

    const id = line!.audioUrl!.slice('/audio/'.length);
    expect(id).toBe(audioId(PERSONAS.soccer.defaultVoiceId, DEFAULT_TTS_MODEL, PERSONAS.soccer.voiceSettings, body.text));
    const audio = announcer.getAudio(id);
    expect(audio?.mime).toBe('audio/mpeg');
    expect(Array.from(audio!.data)).toEqual(Array.from(FAKE_MP3));
    expect(existsSync(join(dir, 'audio-cache', `${id}.mp3`))).toBe(true);

    // Latency is measured and logged.
    expect(announcer.lastTiming).toMatchObject({ event: 'market_opened', textSource: 'template', audio: 'miss' });
    expect(log.infos.some((m) => /market_opened: text=template audio=miss\(first byte \d+ ms, clip \d+ ms\) event-to-line=\d+ ms/.test(m))).toBe(true);
    expect([...log.infos, ...log.warns].join(' ')).not.toContain(KEY);
  });

  it('hits the cache the second time, in memory and from disk after a restart', async () => {
    const fetch = vi.fn<FetchLike>(async () => audioResponse());
    const first = make(env(), fetch);
    const a = await first.announcer.announce(opened, room());
    const b = await first.announcer.announce(opened, room());
    expect(b!.audioUrl).toBe(a!.audioUrl);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.announcer.lastTiming?.audio).toBe('hit');

    // A new process: memory is empty, the disk cache still answers without calling ElevenLabs.
    const fetch2 = vi.fn<FetchLike>(async () => audioResponse());
    const second = make(env(), fetch2);
    const c = await second.announcer.announce(opened, room());
    expect(c!.audioUrl).toBe(a!.audioUrl);
    expect(fetch2).not.toHaveBeenCalled();
    expect(second.announcer.getAudio(a!.audioUrl!.slice(7))?.data.byteLength).toBe(FAKE_MP3.byteLength);
  });

  it('keys the cache on voice, model and text', async () => {
    const fetch = vi.fn<FetchLike>(async () => audioResponse());
    const { announcer } = make(env({ ELEVENLABS_VOICE_NFL: 'customNflVoice' }), fetch);
    const soccer = await announcer.announce({ type: 'market_locked', market: penalty }, room());
    const nfl = await announcer.announce({ type: 'market_locked', market: penalty }, room({ persona: 'nfl', sport: 'nfl' }));
    expect(nfl!.audioUrl).not.toBe(soccer!.audioUrl);
    expect(fetch.mock.calls[1]![0]).toContain('/v1/text-to-speech/customNflVoice/stream');
    const other = make(env({ ELEVENLABS_TTS_MODEL: 'eleven_v4_turbo' }), fetch);
    const sameTextOtherModel = await other.announcer.announce({ type: 'market_locked', market: penalty }, room());
    expect(sameTextOtherModel!.text).toBe(soccer!.text);
    expect(sameTextOtherModel!.audioUrl).not.toBe(soccer!.audioUrl);
    expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string).model_id).toBe('eleven_v4_turbo');
  });

  it('deduplicates concurrent requests for the same clip', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      await sleep(20);
      return audioResponse();
    });
    const { announcer } = make(env(), fetch);
    const [a, b] = await Promise.all([announcer.announce(opened, room()), announcer.announce(opened, room())]);
    expect(a!.audioUrl).toBe(b!.audioUrl);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('warms up the common lines so countdown calls play instantly', async () => {
    const fetch = vi.fn<FetchLike>(async () => audioResponse());
    const { announcer, log } = make(env(), fetch);
    await announcer.warmup('soccer');
    const expected = warmupLines('soccer').length;
    expect(fetch).toHaveBeenCalledTimes(expected);
    expect(readdirSync(join(dir, 'audio-cache'))).toHaveLength(expected);
    expect(log.infos.some((m) => m.includes(`warmup soccer: ${expected} generated`))).toBe(true);

    fetch.mockClear();
    for (const event of [lockSoon, { type: 'market_locked', market: penalty } as AnnouncerEvent, { type: 'market_voided', market: corners } as AnnouncerEvent]) {
      const line = await announcer.announce(event, room());
      expect(line!.audioUrl, event.type).toBeDefined();
      expect(announcer.lastTiming?.audio).toBe('hit');
    }
    expect(fetch).not.toHaveBeenCalled();
    // Warming up again costs nothing.
    await announcer.warmup('soccer');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('prefers a cached variant for time-critical lines', async () => {
    const fetch = vi.fn<FetchLike>(async () => audioResponse());
    const { announcer } = make(env(), fetch);
    // Cache exactly one of the three "locked" variants, then announce many different markets.
    const only = 'Bets are closed. Here we go!';
    await announcer.announce({ type: 'talk_reply', text: only }, room());
    fetch.mockClear();
    for (let i = 0; i < 6; i++) {
      const line = await announcer.announce({ type: 'market_locked', market: { ...penalty, id: `m${i}` } }, room());
      expect(line!.text).toBe(only);
      expect(line!.audioUrl).toBeDefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to Web Speech on an API error, warns once, and recovers after the cooldown', async () => {
    let fail = true;
    const fetch = vi.fn<FetchLike>(async () => (fail ? jsonResponse({ detail: { status: 'internal_error', message: 'boom' } }, 500) : audioResponse()));
    let t = 1_000_000;
    const log = recordingLogger();
    const announcer = new HuddleAnnouncer(env({ ANNOUNCER_TTS_COOLDOWN_MS: '30000' }), offline, { fetch, log, now: () => t });

    const first = await announcer.announce(opened, room());
    expect(first!.text).toContain('77%');
    expect(first!.audioUrl).toBeUndefined();
    expect(announcer.provider).toBe('webspeech');
    expect(announcer.lastTiming?.audio).toBe('error');
    expect(log.warns).toHaveLength(1);
    expect(log.warns[0]).toMatch(/ElevenLabs text to speech failed \(HTTP 500 \(internal_error: boom\)\); falling back to browser Web Speech, retrying in 30 s/);

    // During the cooldown nothing is sent and nothing more is logged.
    const second = await announcer.announce({ type: 'market_locked', market: penalty }, room());
    expect(second!.audioUrl).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log.warns).toHaveLength(1);

    // After the cooldown the next line retries; success brings audio back.
    t += 31_000;
    fail = false;
    expect(announcer.provider).toBe('elevenlabs');
    const third = await announcer.announce({ type: 'market_locked', market: penalty }, room());
    expect(third!.audioUrl).toBeDefined();
    expect(announcer.provider).toBe('elevenlabs');
    expect(log.infos.some((m) => m.includes('ElevenLabs is back'))).toBe(true);
    expect(log.warns).toHaveLength(1);
  });

  it('gives up for good on a rejected key, without logging it', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ detail: { status: 'invalid_api_key', message: `Invalid API key ${KEY}` } }, 401));
    let t = 0;
    const log = recordingLogger();
    const announcer = new HuddleAnnouncer(env(), offline, { fetch, log, now: () => t });
    await announcer.warmup('nfl');
    expect(announcer.provider).toBe('webspeech');
    t += 10 * 60_000;
    const line = await announcer.announce(lockSoon, room({ persona: 'nfl' }));
    expect(line!.audioUrl).toBeUndefined();
    expect(line!.text).toMatch(/Five seconds/);
    expect(announcer.provider).toBe('webspeech');
    // At most the requests already in flight when the first 401 came back.
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
    expect(log.warns).toHaveLength(1);
    expect(log.warns[0]).toMatch(/HTTP 401.*until the key is fixed/);
    expect([...log.warns, ...log.infos].join(' ')).not.toContain(KEY);
    expect(announcer.lastWarning).not.toContain(KEY);
  });

  it('falls back on a network failure and never rejects', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });
    const { announcer, log } = make(env(), fetch);
    const line = await announcer.announce(opened, room());
    expect(line!.audioUrl).toBeUndefined();
    expect(announcer.provider).toBe('webspeech');
    expect(log.warns[0]).toMatch(/fetch failed/);
  });

  it('returns the line without audio when TTS misses the budget, and caches the clip for next time', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      await sleep(400);
      return audioResponse();
    });
    const { announcer } = make(env({ ANNOUNCER_TTS_BUDGET_MS: '50' }), fetch);
    const started = Date.now();
    const line = await announcer.announce(opened, room());
    const took = Date.now() - started;
    expect(line!.text).toContain('77%');
    expect(line!.audioUrl).toBeUndefined();
    expect(took).toBeLessThan(300);
    expect(announcer.lastTiming?.audio).toBe('budget');
    // Still healthy: a slow clip is not an outage.
    expect(announcer.provider).toBe('elevenlabs');

    await sleep(550);
    const again = await announcer.announce(opened, room());
    expect(again!.audioUrl).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives countdown lines a much shorter budget than other lines', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      await sleep(120);
      return audioResponse();
    });
    const { announcer } = make(env({ ANNOUNCER_URGENT_BUDGET_MS: '30' }), fetch);
    const urgent = await announcer.announce(lockSoon, room());
    expect(urgent!.audioUrl).toBeUndefined();
    const normal = await announcer.announce(opened, room());
    expect(normal!.audioUrl).toBeDefined();
  });

  it('keeps working from memory when the cache directory cannot be written', async () => {
    const blocked = join(dir, 'not-a-dir');
    writeFileSync(blocked, 'x');
    const fetch = vi.fn<FetchLike>(async () => audioResponse());
    const { announcer, log } = make(env({ DATA_DIR: blocked }), fetch);
    const line = await announcer.announce(opened, room());
    expect(line!.audioUrl).toBeDefined();
    expect(announcer.getAudio(line!.audioUrl!.slice(7))).toBeDefined();
    expect(log.warns.some((m) => m.includes('memory-only'))).toBe(true);
  });

  it('rejects path tricks in getAudio', () => {
    const { announcer } = make(env(), vi.fn<FetchLike>());
    expect(announcer.getAudio('../../etc/passwd')).toBeUndefined();
    expect(announcer.getAudio('sfx-../../secret')).toBeUndefined();
    expect(announcer.getAudio('')).toBeUndefined();
  });
});

describe('LLM lines inside the announcer', () => {
  function llmReturning(reply: unknown, delayMs = 0): LlmClient & { completeJson: ReturnType<typeof vi.fn> } {
    return {
      available: true,
      completeJson: vi.fn(async () => {
        if (delayMs) await sleep(delayMs);
        return reply;
      }),
    };
  }

  it('speaks a valid LLM line', async () => {
    const llm = llmReturning({ lines: ['Penalty to Portugal! Ronaldo steps up.', 'The room has Yes at 77%. 20 seconds, get in!'] });
    const { announcer } = make({ DATA_DIR: dir }, vi.fn<FetchLike>(), llm);
    const line = await announcer.announce(opened, room());
    expect(line!.text).toBe('Penalty to Portugal! Ronaldo steps up. The room has Yes at 77%. 20 seconds, get in!');
    expect(announcer.lastTiming?.textSource).toBe('llm');
  });

  it('falls back to the template when the LLM invents a number, fails or is slow', async () => {
    const template = (await make({ DATA_DIR: dir }, vi.fn<FetchLike>()).announcer.announce(opened, room()))!.text;
    for (const llm of [llmReturning({ lines: ['Ronaldo steps up! The room has him at 91%!'] }), llmReturning(null), llmReturning('garbage')]) {
      const { announcer, log } = make({ DATA_DIR: dir }, vi.fn<FetchLike>(), llm);
      const line = await announcer.announce(opened, room());
      expect(line!.text).toBe(template);
      expect(announcer.lastTiming?.textSource).toBe('template');
      expect(llm.completeJson).toHaveBeenCalledTimes(1);
      expect(log.warns.filter((w) => !w.includes('ELEVENLABS_API_KEY'))).toEqual([]);
    }
  });

  it('never asks the LLM for time-critical lines', async () => {
    const llm = llmReturning({ lines: ['Hurry!'] });
    const { announcer } = make({ DATA_DIR: dir }, vi.fn<FetchLike>(), llm);
    expect((await announcer.announce(lockSoon, room()))!.text).toMatch(/Five seconds/);
    expect((await announcer.announce({ type: 'market_locked', market: penalty }, room()))!.text).toMatch(/[Ll]ocked|closed/);
    expect((await announcer.announce({ type: 'talk_reply', text: 'Yes is at 77%.' }, room()))!.text).toBe('Yes is at 77%.');
    expect(llm.completeJson).not.toHaveBeenCalled();
  });

  it('can be switched off with ANNOUNCER_LLM_LINES=0', async () => {
    const llm = llmReturning({ lines: ['77% on Yes!'] });
    const { announcer } = make({ DATA_DIR: dir, ANNOUNCER_LLM_LINES: '0' }, vi.fn<FetchLike>(), llm);
    await announcer.announce(opened, room());
    expect(llm.completeJson).not.toHaveBeenCalled();
  });

  it('shares one deadline between the LLM and TTS', async () => {
    // The LLM uses most of the budget; TTS then has too little left and the line goes out as text.
    const llm = llmReturning({ lines: ['Room has Yes at 77%!'] }, 100);
    const fetch = vi.fn<FetchLike>(async () => {
      await sleep(300);
      return audioResponse();
    });
    const { announcer } = make(env({ ANNOUNCER_TTS_BUDGET_MS: '150' }), fetch, llm);
    const line = await announcer.announce(opened, room());
    expect(line!.text).toBe('Room has Yes at 77%!');
    expect(line!.audioUrl).toBeUndefined();
    expect(announcer.lastTiming).toMatchObject({ textSource: 'llm', audio: 'budget' });
  });
});

describe('sound effects on lines', () => {
  const resolved: AnnouncerEvent = {
    type: 'market_resolved',
    market: corners,
    outcomeLabel: 'Yes',
    winners: [{ name: 'Priya', amount: 6 * USDC }],
    losers: [{ name: 'Jake', amount: 2 * USDC }],
  };

  it('sets sfx without sfxUrl when the stinger file is missing', async () => {
    const { announcer } = make({ DATA_DIR: dir, SFX_DIR: join(dir, 'sfx') }, vi.fn<FetchLike>());
    const line = await announcer.announce(resolved, room());
    expect(line!.sfx).toBe('cash_register');
    expect(line!.sfxUrl).toBeUndefined();
    expect(announcer.getAudio('sfx-cash_register')).toBeUndefined();
    const plain = await announcer.announce({ type: 'player_joined', name: 'P', amount: USDC, remote: false }, room());
    expect(plain!.sfx).toBeUndefined();
    expect(plain).not.toHaveProperty('sfxUrl');
  });

  it('sets sfxUrl and serves the file when it exists', async () => {
    const sfxDir = join(dir, 'sfx');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(sfxDir, { recursive: true });
    writeFileSync(join(sfxDir, 'lock_buzzer.mp3'), FAKE_MP3);
    const { announcer } = make({ DATA_DIR: dir, SFX_DIR: sfxDir }, vi.fn<FetchLike>());
    const line = await announcer.announce({ type: 'market_locked', market: penalty }, room());
    expect(line!.sfx).toBe('lock_buzzer');
    expect(line!.sfxUrl).toBe('/audio/sfx-lock_buzzer');
    const audio = announcer.getAudio('sfx-lock_buzzer');
    expect(audio?.mime).toBe('audio/mpeg');
    expect(audio?.data.byteLength).toBe(FAKE_MP3.byteLength);
    expect(announcer.getAudio('sfx-goal_horn')).toBeUndefined();
    expect(announcer.getAudio('sfx-nope')).toBeUndefined();
  });
});

describe('agentSession (ElevenLabs Agents, mocked fetch)', () => {
  it('returns null without an agent id', async () => {
    const fetch = vi.fn<FetchLike>();
    const { announcer } = make(env(), fetch);
    expect(await announcer.agentSession({ partyCode: 'ABCD', playerName: 'Jake', sessionToken: 'tok' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gets a signed URL and passes the dynamic variables', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_1&conversation_signature=sig' }));
    const { announcer } = make(env({ ELEVENLABS_AGENT_ID: 'agent_1' }), fetch);
    const session = await announcer.agentSession({ partyCode: 'ABCD', playerName: 'Jake', sessionToken: 'tok-123' });
    expect(session).toEqual({
      agentId: 'agent_1',
      signedUrl: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_1&conversation_signature=sig',
      dynamicVariables: { party_code: 'ABCD', player_name: 'Jake', session_token: 'tok-123' },
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent_1');
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>)['xi-api-key']).toBe(KEY);
  });

  it('uses a per-persona agent when configured, and a room name when the box is talking', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ signed_url: 'wss://x' }));
    const { announcer } = make(env({ ELEVENLABS_AGENT_ID: 'agent_default', ELEVENLABS_AGENT_ID_NFL: 'agent_nfl' }), fetch);
    await announcer.warmup('nfl');
    fetch.mockClear();
    const session = await announcer.agentSession({ partyCode: 'ABCD', sessionToken: 'tok' });
    expect(session?.agentId).toBe('agent_nfl');
    expect(session?.dynamicVariables.player_name).toBe('the room');
    expect(fetch.mock.calls[0]![0]).toContain('agent_id=agent_nfl');
  });

  it('returns null (offline TALK fallback) when the API fails', async () => {
    const log = recordingLogger();
    const bad = new HuddleAnnouncer(env({ ELEVENLABS_AGENT_ID: 'agent_1' }), offline, { fetch: async () => jsonResponse({ detail: 'nope' }, 404), log });
    expect(await bad.agentSession({ partyCode: 'ABCD', sessionToken: 'tok' })).toBeNull();
    const empty = new HuddleAnnouncer(env({ ELEVENLABS_AGENT_ID: 'agent_1' }), offline, { fetch: async () => jsonResponse({}), log });
    expect(await empty.agentSession({ partyCode: 'ABCD', sessionToken: 'tok' })).toBeNull();
    expect(log.warns.every((w) => w.includes('TALK uses the offline fallback') && !w.includes(KEY) && !w.includes('tok'))).toBe(true);
  });
});

describe('Limiter', () => {
  it('caps concurrency and lets urgent work jump the queue', async () => {
    const limiter = new Limiter(2);
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    const job = (name: string, urgent = false) =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(15);
        order.push(name);
        active -= 1;
      }, urgent);
    await Promise.all([job('a'), job('b'), job('c'), job('d'), job('urgent', true)]);
    expect(peak).toBe(2);
    expect(order.indexOf('urgent')).toBeLessThan(order.indexOf('c'));
    expect(order).toHaveLength(5);
  });
});
