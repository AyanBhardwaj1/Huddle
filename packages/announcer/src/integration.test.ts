import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HuddleAnnouncer } from './announcer';
import { createLlmClient } from './llm';
import { penalty, recordingLogger, room, talk } from './test/fixtures';

/**
 * End-to-end over real HTTP (no mocked fetch): a local server stands in for the ElevenLabs and
 * Anthropic APIs so the real `fetch`, the streamed body reader and the abort path are exercised.
 */

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let base: string;
let dir: string;
const seen: Seen[] = [];
let llmDelayMs = 0;
let llmReply = '{"lines":["Penalty to Portugal! Ronaldo steps up.","Room has Yes at 77%. 20 seconds, get in!"]}';
const CHUNKS = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6, 7, 8, 9])];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'huddle-announcer-int-'));
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const url = req.url ?? '';
      if (url.startsWith('/v1/text-to-speech/') && url.includes('/stream')) {
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'transfer-encoding': 'chunked' });
        let i = 0;
        const next = (): void => {
          if (i >= CHUNKS.length) return void res.end();
          res.write(CHUNKS[i++]);
          setTimeout(next, 25);
        };
        setTimeout(next, 25);
      } else if (url === '/v1/messages') {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: llmReply }] }));
        }, llmDelayMs);
      } else if (url.startsWith('/v1/convai/conversation/get-signed-url')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ signed_url: 'wss://example.test/convai?conversation_signature=abc' }));
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'not found' }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

function build(extra: Record<string, string> = {}) {
  const env = {
    ELEVENLABS_API_KEY: 'xi-int-key',
    ELEVENLABS_BASE_URL: base,
    ELEVENLABS_AGENT_ID: 'agent_int',
    ANTHROPIC_API_KEY: 'sk-int-key',
    ANTHROPIC_BASE_URL: base,
    DATA_DIR: dir,
    SFX_DIR: join(dir, 'sfx'),
    ...extra,
  };
  const log = recordingLogger();
  const llm = createLlmClient(env, { log });
  return { announcer: new HuddleAnnouncer(env, llm, { log }), log };
}

describe('announcer over real HTTP', () => {
  it('goes event -> LLM line -> streamed TTS -> cached clip well inside the 2.5 s target', async () => {
    const { announcer } = build();
    const started = Date.now();
    const line = await announcer.announce({ type: 'market_opened', market: penalty, lockInSecs: 20 }, room());
    const took = Date.now() - started;
    expect(line!.text).toBe('Penalty to Portugal! Ronaldo steps up. Room has Yes at 77%. 20 seconds, get in!');
    expect(line!.audioUrl).toMatch(/^\/audio\/[a-f0-9]{32}$/);
    expect(took).toBeLessThan(2500);

    const t = announcer.lastTiming!;
    expect(t).toMatchObject({ textSource: 'llm', audio: 'miss' });
    // Streaming: the first byte arrives before the clip is complete.
    expect(t.ttfbMs!).toBeLessThan(t.ttsMs!);

    const audio = announcer.getAudio(line!.audioUrl!.slice('/audio/'.length));
    expect(Array.from(audio!.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const tts = seen.find((s) => s.url.includes('/v1/text-to-speech/'))!;
    expect(tts.method).toBe('POST');
    expect(tts.url).toBe('/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream?output_format=mp3_44100_128');
    expect(tts.headers['xi-api-key']).toBe('xi-int-key');
    expect(JSON.parse(tts.body)).toMatchObject({ text: expect.stringContaining('77 percent'), model_id: 'eleven_flash_v2_5' });
    const msg = seen.find((s) => s.url === '/v1/messages')!;
    expect(msg.headers['x-api-key']).toBe('sk-int-key');
    expect(msg.headers['anthropic-version']).toBe('2026-10-21');
    expect(JSON.parse(msg.body)).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' } });
  });

  it('uses the template when the LLM is slower than its timeout, and still gets audio', async () => {
    llmDelayMs = 2500;
    try {
      const { announcer } = build({ ANNOUNCER_TTS_BUDGET_MS: '3000' });
      const started = Date.now();
      const line = await announcer.announce({ type: 'market_opened', market: { ...penalty, id: 'm-slow' }, lockInSecs: 20 }, room());
      const took = Date.now() - started;
      expect(line!.text).toMatch(/Ronaldo steps up\. .*77%/);
      expect(line!.text).not.toBe('Penalty to Portugal! Ronaldo steps up. Room has Yes at 77%. 20 seconds, get in!');
      expect(announcer.lastTiming).toMatchObject({ textSource: 'template' });
      expect(announcer.lastTiming!.llmMs!).toBeGreaterThanOrEqual(1400);
      expect(announcer.lastTiming!.llmMs!).toBeLessThan(2000);
      expect(line!.audioUrl).toBeDefined();
      expect(took).toBeLessThan(2500);
    } finally {
      llmDelayMs = 0;
    }
  }, 10_000);

  it('rejects an LLM line with an invented number over the wire too', async () => {
    const before = llmReply;
    llmReply = '{"lines":["Ronaldo has scored 9 of 10. Room says 77%!"]}';
    try {
      const { announcer, log } = build();
      const line = await announcer.announce({ type: 'market_opened', market: { ...penalty, id: 'm-bad' }, lockInSecs: 20 }, room());
      expect(line!.text).not.toContain('9 of 10');
      expect(log.infos.some((m) => m.includes('LLM line rejected (invented_number)'))).toBe(true);
    } finally {
      llmReply = before;
    }
  });

  it('answers TALK and opens an agent session', async () => {
    const { announcer } = build({ ANNOUNCER_LLM_TALK: '0' });
    const reply = await announcer.answer('put 5 on yes for me', talk());
    expect(reply.draft).toEqual({ marketId: 'm-pen', outcome: 'yes', amount: 5_000_000 });
    const session = await announcer.agentSession({ partyCode: 'ABCD', playerName: 'Jake', sessionToken: 'tok' });
    expect(session).toEqual({
      agentId: 'agent_int',
      signedUrl: 'wss://example.test/convai?conversation_signature=abc',
      dynamicVariables: { party_code: 'ABCD', player_name: 'Jake', session_token: 'tok' },
    });
    const req = seen.find((s) => s.url.startsWith('/v1/convai/conversation/get-signed-url'))!;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/v1/convai/conversation/get-signed-url?agent_id=agent_int');
    expect(req.headers['xi-api-key']).toBe('xi-int-key');
  });
});
