import { join } from 'node:path';
import {
  ANNOUNCER_PRIORITY,
  randomId,
  type AgentSession,
  type Announcer,
  type AnnouncerEvent,
  type AnnouncerEventType,
  type AnnouncerLine,
  type LlmClient,
  type Persona,
  type RoomContext,
  type TalkContext,
  type TalkReply,
} from '@huddle/shared';
import { createAgentSession } from './agent';
import { TEMPLATE_ONLY_EVENTS, llmLine } from './lines';
import { consoleLogger, envNumber, redact, resolveFetch, type Env, type FetchLike, type Logger } from './log';
import { speakable } from './numbers';
import { PERSONAS, isPersona, voiceIdFor } from './personas';
import { SFX_ID_PREFIX, SfxLibrary, sfxFor } from './sfx';
import { answerTalk, rephraseReply } from './talk';
import { eventSeed, templateLine, warmupLines } from './templates';
import { AUDIO_MIME, AudioCache, DEFAULT_TTS_MODEL, ELEVENLABS_BASE_URL, ElevenLabsError, ElevenLabsTts, Limiter, audioId } from './tts';

/**
 * The announcer (PRD section 7): event -> line text (LLM with template fallback) -> ElevenLabs speech
 * with a cache. It never throws and never blocks longer than its budget: a line that cannot get audio
 * in time is returned without `audioUrl`, and the client speaks it with the Web Speech API.
 */

/** Event-to-audio target from the PRD. */
export const LATENCY_TARGET_MS = 2500;
/** Lines whose audio would arrive later than this (measured from the event) go out as text only. */
export const DEFAULT_TTS_BUDGET_MS = 2200;
/** Countdown lines are worthless late: without a cached clip they only wait this long. */
export const DEFAULT_URGENT_BUDGET_MS = 800;
/** Low and medium priority lines are dropped by the playback queue after 6 s; do not wait that long. */
export const DEFAULT_RELAXED_BUDGET_MS = 4000;

/** The one voice id confirmed in the official API examples; used when a persona's own voice is rejected. */
const FALLBACK_VOICE_ID = PERSONAS.soccer.defaultVoiceId;

const URGENT_EVENTS: ReadonlySet<AnnouncerEventType> = new Set(['lock_soon', 'market_locked']);

export interface AnnouncerOptions {
  fetch?: FetchLike;
  log?: Logger;
  now?: () => number;
}

export interface LineTiming {
  event: AnnouncerEventType;
  textSource: 'llm' | 'template';
  llmMs?: number;
  audio: 'hit' | 'miss' | 'budget' | 'error' | 'off';
  ttfbMs?: number;
  ttsMs?: number;
  totalMs: number;
}

type SynthOutcome = { ok: true; ttfbMs: number; totalMs: number } | { ok: false };

export class HuddleAnnouncer implements Announcer {
  private persona: Persona = 'soccer';
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly fetchImpl: FetchLike;
  private readonly apiKey: string | undefined;
  private readonly modelId: string;
  private readonly tts: ElevenLabsTts | null;
  private readonly cache: AudioCache;
  private readonly sfx: SfxLibrary;
  private readonly limiter: Limiter;
  private readonly inflight = new Map<string, Promise<SynthOutcome>>();
  private readonly budgetMs: number;
  private readonly urgentBudgetMs: number;
  private readonly relaxedBudgetMs: number;
  private readonly cooldownMs: number;
  private readonly useLlmLines: boolean;
  private readonly useLlmTalk: boolean;
  /** While set, ElevenLabs is considered down and lines go out as text (Web Speech). */
  private down: { until: number; permanent: boolean } | null = null;
  private warnedNoKey = false;
  private readonly voiceOverride = new Map<Persona, string>();
  /** The last warning, for the host screen. */
  lastWarning: string | null = null;
  /** Timing of the most recent line, for logs and tests. */
  lastTiming: LineTiming | null = null;

  constructor(
    private readonly env: Env,
    private readonly llm: LlmClient,
    opts: AnnouncerOptions = {},
  ) {
    this.log = opts.log ?? consoleLogger;
    this.now = opts.now ?? Date.now;
    this.fetchImpl = resolveFetch(opts.fetch);
    this.apiKey = env.ELEVENLABS_API_KEY?.trim() || undefined;
    this.modelId = env.ELEVENLABS_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
    const baseUrl = (env.ELEVENLABS_BASE_URL?.trim() || ELEVENLABS_BASE_URL).replace(/\/+$/, '');
    this.tts = this.apiKey ? new ElevenLabsTts(this.apiKey, this.fetchImpl, { baseUrl, now: this.now }) : null;
    const cacheDir = join(env.DATA_DIR?.trim() || './data', 'audio-cache');
    this.cache = new AudioCache(cacheDir, 400, (msg) => this.log.warn(`[announcer] audio cache is memory-only: ${msg}`));
    this.sfx = new SfxLibrary(env);
    this.limiter = new Limiter(Math.max(1, envNumber(env, 'ELEVENLABS_MAX_CONCURRENCY', 3)));
    this.budgetMs = envNumber(env, 'ANNOUNCER_TTS_BUDGET_MS', DEFAULT_TTS_BUDGET_MS);
    this.urgentBudgetMs = Math.min(this.budgetMs, envNumber(env, 'ANNOUNCER_URGENT_BUDGET_MS', DEFAULT_URGENT_BUDGET_MS));
    this.relaxedBudgetMs = Math.max(this.budgetMs, envNumber(env, 'ANNOUNCER_RELAXED_BUDGET_MS', DEFAULT_RELAXED_BUDGET_MS));
    this.cooldownMs = envNumber(env, 'ANNOUNCER_TTS_COOLDOWN_MS', 30_000);
    this.useLlmLines = env.ANNOUNCER_LLM_LINES !== '0';
    this.useLlmTalk = env.ANNOUNCER_LLM_TALK !== '0';
  }

  /** `elevenlabs` while speech synthesis is working, `webspeech` with no key or during an outage. */
  get provider(): 'elevenlabs' | 'webspeech' {
    return this.ttsUsable() ? 'elevenlabs' : 'webspeech';
  }

  private ttsUsable(): boolean {
    if (!this.tts) return false;
    if (!this.down) return true;
    if (this.down.permanent) return false;
    return this.now() >= this.down.until; // half-open: the next line retries
  }

  private warn(msg: string): void {
    const clean = redact(msg, [this.apiKey]);
    this.lastWarning = clean;
    this.log.warn(`[announcer] ${clean}`);
  }

  private warnNoKeyOnce(): void {
    if (this.tts || this.warnedNoKey) return;
    this.warnedNoKey = true;
    this.warn('ELEVENLABS_API_KEY is not set: announcer lines are spoken by the browser (Web Speech)');
  }

  private voice(persona: Persona): { voiceId: string; settings: (typeof PERSONAS)[Persona]['voiceSettings'] } {
    return { voiceId: this.voiceOverride.get(persona) ?? voiceIdFor(persona, this.env), settings: PERSONAS[persona].voiceSettings };
  }

  private idFor(persona: Persona, spoken: string): string {
    const v = this.voice(persona);
    return audioId(v.voiceId, this.modelId, v.settings, spoken);
  }

  /** Synthesize into the cache (deduplicated per clip). Never throws. */
  private synthesize(persona: Persona, spoken: string, id: string, urgent: boolean): Promise<SynthOutcome> {
    const running = this.inflight.get(id);
    if (running) return running;
    const tts = this.tts;
    if (!tts) return Promise.resolve({ ok: false });
    const v = this.voice(persona);
    const job = this.limiter
      .run(async (): Promise<SynthOutcome> => {
        // Skip work queued before an outage began or before this persona's voice was swapped.
        if (!this.ttsUsable() || this.voice(persona).voiceId !== v.voiceId) return { ok: false };
        try {
          const res = await tts.synthesize({ voiceId: v.voiceId, modelId: this.modelId, text: spoken, settings: v.settings });
          this.cache.set(id, res.data);
          if (this.down) {
            this.down = null;
            this.log.info('[announcer] ElevenLabs is back: lines carry audio again');
          }
          return { ok: true, ttfbMs: res.ttfbMs, totalMs: res.totalMs };
        } catch (err) {
          this.onTtsError(err, persona, v.voiceId);
          return { ok: false };
        }
      }, urgent)
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, job);
    return job;
  }

  private onTtsError(err: unknown, persona: Persona, voiceId: string): void {
    const e = err instanceof ElevenLabsError ? err : new ElevenLabsError(0, err instanceof Error ? err.message : 'unknown error');
    // A voice id the account cannot use (wrong id, removed voice) only breaks that persona: switch it to
    // the stock fallback voice instead of dropping the whole room to browser speech.
    if ([400, 404, 422].includes(e.status) && voiceId !== FALLBACK_VOICE_ID) {
      if (!this.voiceOverride.has(persona)) {
        this.voiceOverride.set(persona, FALLBACK_VOICE_ID);
        this.warn(`voice ${voiceId} for the ${persona} persona was rejected (${e.message}); using the default voice instead`);
      }
      return;
    }
    const alreadyDown = this.down !== null;
    const cooldown = e.status === 429 ? Math.min(this.cooldownMs, 10_000) : this.cooldownMs;
    this.down = { until: this.now() + cooldown, permanent: e.permanent };
    // One warning per outage, not one per line.
    if (!alreadyDown) {
      this.warn(
        `ElevenLabs text to speech failed (${e.message}); falling back to browser Web Speech` +
          (e.permanent ? ' until the key is fixed' : `, retrying in ${Math.round(cooldown / 1000)} s`),
      );
    }
  }

  async warmup(persona: Persona): Promise<void> {
    if (isPersona(persona)) this.persona = persona;
    if (!this.tts) {
      this.warnNoKeyOnce();
      return;
    }
    const started = this.now();
    const p = this.persona;
    const lines = warmupLines(p);
    let generated = 0;
    let cached = 0;
    const pass = async (): Promise<void> => {
      generated = 0;
      cached = 0;
      await Promise.all(
        lines.map(async (text) => {
          const spoken = speakable(text);
          const id = this.idFor(p, spoken);
          if (this.cache.has(id)) {
            cached += 1;
            return;
          }
          const res = await this.synthesize(p, spoken, id, false);
          if (res.ok) generated += 1;
        }),
      );
    };
    const voiceBefore = this.voice(p).voiceId;
    await pass();
    // The persona's voice was rejected and swapped for the fallback: warm that one up instead.
    if (this.voice(p).voiceId !== voiceBefore) await pass();
    this.log.info(
      `[announcer] warmup ${p}: ${generated} generated, ${cached} already cached, ${lines.length - generated - cached} failed in ${this.now() - started} ms`,
    );
  }

  async announce(event: AnnouncerEvent, ctx: RoomContext): Promise<AnnouncerLine | null> {
    const started = this.now();
    try {
      return await this.announceInner(event, ctx, started);
    } catch (err) {
      // Last line of defence: the engine never awaits this in the bet path, but it must not reject either.
      this.log.warn(`[announcer] ${event.type} failed: ${redact(err instanceof Error ? err.message : 'unknown error', [this.apiKey])}`);
      return null;
    }
  }

  private async announceInner(event: AnnouncerEvent, ctx: RoomContext, started: number): Promise<AnnouncerLine | null> {
    const persona: Persona = isPersona(ctx.persona) ? ctx.persona : this.persona;
    const room: RoomContext = { ...ctx, persona };
    const urgent = URGENT_EVENTS.has(event.type);
    const priority = ANNOUNCER_PRIORITY[event.type];
    const seed = eventSeed(event, room);

    // Time-critical lines prefer a variant whose audio is already cached, so they play instantly.
    const fallback = templateLine(event, room, {
      seed,
      prefer: urgent && this.tts ? (t) => this.cache.has(this.idFor(persona, speakable(t, room.sport))) : undefined,
    });
    if (!fallback) return null;

    let text = fallback;
    let textSource: 'llm' | 'template' = 'template';
    let llmMs: number | undefined;
    if (this.useLlmLines && this.llm.available && !TEMPLATE_ONLY_EVENTS.has(event.type)) {
      const res = await llmLine(this.llm, event, room, { now: this.now });
      llmMs = res.ms;
      if (res.text) {
        text = res.text;
        textSource = 'llm';
      } else if (res.rejection && res.rejection !== 'no_reply') {
        this.log.info(`[announcer] ${event.type}: LLM line rejected (${res.rejection}), using template`);
      }
    }

    const sfx = sfxFor(event, room);
    const line: AnnouncerLine = {
      id: randomId(8),
      text,
      priority,
      createdAt: new Date(this.now()).toISOString(),
      event: event.type,
      marketId: 'market' in event ? event.market.id : undefined,
      persona,
      ...(sfx ? { sfx, sfxUrl: this.sfx.url(sfx) } : {}),
    };

    const timing: LineTiming = { event: event.type, textSource, llmMs, audio: 'off', totalMs: 0 };
    if (!this.tts) {
      this.warnNoKeyOnce();
    } else {
      const spoken = speakable(text, room.sport);
      const id = this.idFor(persona, spoken);
      if (this.cache.has(id)) {
        line.audioUrl = `/audio/${id}`;
        timing.audio = 'hit';
      } else if (!this.ttsUsable()) {
        timing.audio = 'error';
      } else {
        const budget = urgent ? this.urgentBudgetMs : priority === 'high' ? this.budgetMs : this.relaxedBudgetMs;
        const remaining = Math.max(0, budget - (this.now() - started));
        const job = this.synthesize(persona, spoken, id, urgent || priority === 'high');
        let timer: ReturnType<typeof setTimeout> | undefined;
        const res = await Promise.race([
          job,
          new Promise<'budget'>((resolve) => {
            timer = setTimeout(() => resolve('budget'), remaining);
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (res === 'budget') {
          // Late audio is worse than browser speech. The clip still lands in the cache for next time.
          timing.audio = 'budget';
        } else if (res.ok) {
          line.audioUrl = `/audio/${id}`;
          timing.audio = 'miss';
          timing.ttfbMs = res.ttfbMs;
          timing.ttsMs = res.totalMs;
        } else {
          timing.audio = 'error';
        }
      }
    }
    timing.totalMs = this.now() - started;
    this.lastTiming = timing;
    this.logTiming(timing);
    return line;
  }

  private logTiming(t: LineTiming): void {
    const parts = [
      `text=${t.textSource}${t.llmMs !== undefined ? `(${t.llmMs} ms)` : ''}`,
      `audio=${t.audio}${t.ttfbMs !== undefined ? `(first byte ${t.ttfbMs} ms, clip ${t.ttsMs} ms)` : ''}`,
      `event-to-line=${t.totalMs} ms`,
    ];
    const msg = `[announcer] ${t.event}: ${parts.join(' ')}`;
    if (t.totalMs > LATENCY_TARGET_MS) this.log.warn(`${msg} (over the ${LATENCY_TARGET_MS} ms target)`);
    else this.log.info(msg);
  }

  getAudio(id: string): { mime: string; data: Uint8Array } | undefined {
    if (typeof id !== 'string') return undefined;
    const clean = id.replace(/\.mp3$/i, '');
    const data = clean.startsWith(SFX_ID_PREFIX) ? this.sfx.get(clean) : this.cache.get(clean);
    return data ? { mime: AUDIO_MIME, data } : undefined;
  }

  async answer(text: string, ctx: TalkContext): Promise<TalkReply> {
    const persona: Persona = isPersona(ctx.persona) ? ctx.persona : this.persona;
    const room: TalkContext = { ...ctx, persona };
    try {
      const { intent: _intent, ...reply } = answerTalk(text, room);
      if (this.useLlmTalk && this.llm.available) {
        // Phrasing only: the draft comes from the rules and is never changed by the LLM.
        const styled = await rephraseReply(this.llm, reply.text, room).catch(() => null);
        if (styled) return { ...reply, text: styled };
      }
      return reply;
    } catch (err) {
      this.log.warn(`[announcer] TALK answer failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return { text: "Sorry, I missed that. Ask me the odds, the score, or who's winning." };
    }
  }

  async agentSession(params: { partyCode: string; playerName?: string; sessionToken: string }): Promise<AgentSession | null> {
    return createAgentSession(params, { env: this.env, persona: this.persona, fetch: this.fetchImpl, log: this.log });
  }
}
