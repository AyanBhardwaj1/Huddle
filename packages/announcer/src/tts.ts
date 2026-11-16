import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchLike } from './log';

/**
 * ElevenLabs Text to Speech (streaming endpoint) + audio cache.
 *
 * Verified against the official API reference on 2026-11-16:
 *   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128
 *   header  xi-api-key: <key>
 *   body    { text, model_id, voice_settings: { stability, similarity_boost, style, use_speaker_boost, speed } }
 *   200 -> streamed audio bytes; 422 -> { detail: [...] }
 * `optimize_streaming_latency` is deprecated and is not sent. The low-latency models skip text
 * normalisation by default, so callers pass already-speakable text (see `speakable`).
 */

export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
/** Low-latency model ("Ultra-fast model optimized for real-time use", ~100 ms). Override with ELEVENLABS_TTS_MODEL. */
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
export const TTS_OUTPUT_FORMAT = 'mp3_44100_128';
export const AUDIO_MIME = 'audio/mpeg';

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

export class ElevenLabsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ElevenLabsError';
  }
  /** The key is wrong or lacks permission: retrying will not help. */
  get permanent(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Pull a short human message out of an ElevenLabs error body without echoing anything sensitive. */
export async function describeError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { detail?: unknown };
    const d = body.detail;
    if (typeof d === 'string') detail = d;
    else if (Array.isArray(d)) detail = d.map((x: { msg?: unknown }) => (typeof x?.msg === 'string' ? x.msg : '')).filter(Boolean).join('; ');
    else if (d && typeof d === 'object') {
      const o = d as { status?: unknown; message?: unknown };
      detail = [o.status, o.message].filter((x): x is string => typeof x === 'string').join(': ');
    }
  } catch {
    /* body was not JSON */
  }
  return `HTTP ${res.status}${detail ? ` (${detail.slice(0, 160)})` : ''}`;
}

export interface TtsResult {
  data: Uint8Array;
  /** Time to the first audio byte, ms. */
  ttfbMs: number;
  totalMs: number;
}

export interface TtsRequest {
  voiceId: string;
  modelId: string;
  text: string;
  settings: VoiceSettings;
}

export class ElevenLabsTts {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
    private readonly opts: { baseUrl?: string; hardTimeoutMs?: number; now?: () => number } = {},
  ) {}

  /** Synthesize one line with the streaming endpoint. Throws `ElevenLabsError` on any failure. */
  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const now = this.opts.now ?? Date.now;
    const started = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.hardTimeoutMs ?? 12_000);
    try {
      const url = `${this.opts.baseUrl ?? ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}/stream?output_format=${TTS_OUTPUT_FORMAT}`;
      const res = await this.fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json', accept: AUDIO_MIME },
        body: JSON.stringify({ text: req.text, model_id: req.modelId, voice_settings: req.settings }),
      });
      if (!res.ok) throw new ElevenLabsError(res.status, await describeError(res));
      const chunks: Uint8Array[] = [];
      let ttfbMs = -1;
      let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength) {
            if (ttfbMs < 0) ttfbMs = now() - started;
            chunks.push(value);
            size += value.byteLength;
          }
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        ttfbMs = now() - started;
        chunks.push(buf);
        size = buf.byteLength;
      }
      if (size === 0) throw new ElevenLabsError(502, 'empty audio response');
      const data = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        data.set(c, offset);
        offset += c.byteLength;
      }
      return { data, ttfbMs: Math.max(ttfbMs, 0), totalMs: now() - started };
    } catch (err) {
      if (err instanceof ElevenLabsError) throw err;
      const msg = controller.signal.aborted ? 'request timed out' : err instanceof Error ? err.message : 'network error';
      throw new ElevenLabsError(0, msg);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Cache key: hash(persona voice + model + voice settings + text). Also the id in `/audio/<id>`. */
export function audioId(voiceId: string, modelId: string, settings: VoiceSettings, text: string): string {
  return createHash('sha256')
    .update([voiceId, modelId, JSON.stringify(settings), TTS_OUTPUT_FORMAT, text].join('\u0000'))
    .digest('hex')
    .slice(0, 32);
}

const ID_RE = /^[a-f0-9]{16,64}$/;

/** Two-level audio cache: a bounded in-memory map in front of `DATA_DIR/audio-cache/<id>.mp3`. */
export class AudioCache {
  private readonly mem = new Map<string, Uint8Array>();
  private diskOk = true;

  constructor(
    private readonly dir: string | null,
    private readonly maxEntries = 400,
    private readonly onDiskError?: (msg: string) => void,
  ) {}

  private file(id: string): string | null {
    return this.dir && ID_RE.test(id) ? join(this.dir, `${id}.mp3`) : null;
  }

  has(id: string): boolean {
    if (this.mem.has(id)) return true;
    const f = this.file(id);
    return !!f && this.diskOk && existsSync(f);
  }

  get(id: string): Uint8Array | undefined {
    const hit = this.mem.get(id);
    if (hit) {
      // Refresh recency.
      this.mem.delete(id);
      this.mem.set(id, hit);
      return hit;
    }
    const f = this.file(id);
    if (!f || !this.diskOk) return undefined;
    try {
      if (!existsSync(f)) return undefined;
      const data = new Uint8Array(readFileSync(f));
      if (!data.byteLength) return undefined;
      this.remember(id, data);
      return data;
    } catch {
      return undefined;
    }
  }

  set(id: string, data: Uint8Array): void {
    this.remember(id, data);
    const f = this.file(id);
    if (!f || !this.diskOk || !this.dir) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      // Write then rename so a crash never leaves a half-written clip behind.
      const tmp = `${f}.${process.pid}.tmp`;
      writeFileSync(tmp, data);
      renameSync(tmp, f);
    } catch (err) {
      // A read-only disk must not break the announcer: keep the in-memory cache only.
      this.diskOk = false;
      this.onDiskError?.(err instanceof Error ? err.message : 'disk write failed');
    }
  }

  private remember(id: string, data: Uint8Array): void {
    this.mem.delete(id);
    this.mem.set(id, data);
    while (this.mem.size > this.maxEntries) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
    }
  }
}

/** Small concurrency gate: ElevenLabs plans cap concurrent requests; urgent lines jump the queue. */
export class Limiter {
  private active = 0;
  private readonly waiting: { urgent: boolean; start: () => void }[] = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>, urgent = false): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => {
        const entry = { urgent, start: resolve };
        if (urgent) {
          const firstNormal = this.waiting.findIndex((w) => !w.urgent);
          if (firstNormal === -1) this.waiting.push(entry);
          else this.waiting.splice(firstNormal, 0, entry);
        } else {
          this.waiting.push(entry);
        }
      });
    } else {
      this.active += 1;
    }
    try {
      return await fn();
    } finally {
      // Hand the slot straight to the next waiter so a newcomer cannot slip past the limit.
      const next = this.waiting.shift();
      if (next) next.start();
      else this.active -= 1;
    }
  }
}
