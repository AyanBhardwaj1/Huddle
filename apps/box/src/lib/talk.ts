import type { AgentSession, ClientRequest } from '@huddle/shared';

/**
 * TALK push-to-talk (PRD section 7 / DECISIONS D12), three paths in order of preference:
 *   1. ElevenLabs agent (GET /agent/session returns one): a live voice conversation while held.
 *   2. Browser SpeechRecognition: transcribe while held, send `talk_text` on release; the engine
 *      answers with an announcer line.
 *   3. Neither: ask the UI to show a small text box (`needText`).
 */

export type TalkPhase = 'idle' | 'connecting' | 'listening' | 'sending' | 'text';
export interface TalkState {
  phase: TalkPhase;
  mode: 'agent' | 'speech' | 'text' | null;
  transcript: string;
  error: string | null;
}
export const IDLE_TALK: TalkState = { phase: 'idle', mode: null, transcript: '', error: null };

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => RecognitionLike;

export function speechRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface AgentConversation {
  endSession(): Promise<void>;
  setMicMuted(muted: boolean): void;
}

export interface TalkControllerOptions {
  partyCode: string;
  request: (body: ClientRequest) => Promise<unknown>;
  getAgent: (partyCode: string) => Promise<AgentSession | null>;
  onState: (s: TalkState) => void;
  /** Called on press so the announcer stops talking over the speaker. */
  onPress?: () => void;
}

export class TalkController {
  private state: TalkState = IDLE_TALK;
  private agentPromise: Promise<AgentSession | null> | null = null;
  private recognition: RecognitionLike | null = null;
  private transcript = '';
  private recognitionEnded: Promise<void> | null = null;
  private conversation: Promise<AgentConversation | null> | null = null;
  private held = false;
  /** Resolves when the agent finishes a spoken reply (mode speaking -> listening). */
  private agentDone: (() => void) | null = null;
  private agentSpeaking = false;

  constructor(private readonly opts: TalkControllerOptions) {}

  private set(patch: Partial<TalkState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState(this.state);
  }

  private agent(): Promise<AgentSession | null> {
    this.agentPromise ??= this.opts.getAgent(this.opts.partyCode).catch(() => null);
    return this.agentPromise;
  }

  async press(): Promise<void> {
    if (this.held || this.state.phase === 'sending') return;
    this.held = true;
    this.opts.onPress?.();
    this.opts.request({ type: 'talk_start' }).catch(() => {});
    this.set({ phase: 'connecting', transcript: '', error: null });
    const agent = await this.agent();
    if (!this.held) return; // released while we were looking up the agent: a tap, not a hold
    if (agent) return this.startAgent(agent);
    const Rec = speechRecognitionCtor();
    if (Rec) return this.startRecognition(Rec);
    this.set({ phase: 'text', mode: 'text' });
  }

  async release(): Promise<void> {
    if (!this.held) return;
    this.held = false;
    this.opts.request({ type: 'talk_end' }).catch(() => {});
    if (this.state.mode === 'agent' && this.conversation) {
      // Release = stop listening, let the agent finish its answer, then hang up.
      const conv = this.conversation;
      this.conversation = null;
      this.set({ phase: 'sending' });
      const c = await conv;
      if (c) {
        try {
          c.setMicMuted(true);
        } catch {}
        await new Promise<void>((resolve) => {
          const quiet = setTimeout(() => !this.agentSpeaking && resolve(), 8000); // no reply started
          const cap = setTimeout(resolve, 30_000);
          this.agentDone = () => {
            clearTimeout(quiet);
            clearTimeout(cap);
            resolve();
          };
        });
        this.agentDone = null;
        await c.endSession().catch(() => {});
      }
      this.set({ phase: 'idle' });
      return;
    }
    if (this.state.mode === 'speech' && this.recognition) {
      this.set({ phase: 'sending' });
      try {
        this.recognition.stop();
      } catch {}
      await Promise.race([this.recognitionEnded, new Promise((r) => setTimeout(r, 1500))]);
      this.recognition = null;
      const text = this.transcript.trim();
      if (text) await this.sendText(text);
      else this.set({ phase: 'idle', error: "Didn't catch that" });
      return;
    }
    if (this.state.phase === 'connecting') this.set({ phase: 'idle' });
    // phase 'text' stays open until the user submits or cancels
  }

  async sendText(text: string): Promise<void> {
    const t = text.trim().slice(0, 300);
    if (!t) return;
    this.set({ phase: 'sending', transcript: t });
    try {
      await this.opts.request({ type: 'talk_text', text: t });
      this.set({ phase: 'idle', error: null });
    } catch (e) {
      this.set({ phase: 'idle', error: (e as Error).message });
    }
  }

  cancelText(): void {
    this.set({ ...IDLE_TALK });
  }

  dispose(): void {
    this.held = false;
    try {
      this.recognition?.stop();
    } catch {}
    void this.conversation?.then((c) => c?.endSession().catch(() => {}));
  }

  private startAgent(agent: AgentSession): void {
    this.set({ phase: 'listening', mode: 'agent' });
    this.conversation = (async () => {
      try {
        const { Conversation } = await import('@elevenlabs/client');
        this.agentSpeaking = false;
        const common = {
          dynamicVariables: agent.dynamicVariables,
          onError: (m: string) => this.set({ error: m }),
          onModeChange: ({ mode }: { mode: 'speaking' | 'listening' }) => {
            if (mode === 'speaking') this.agentSpeaking = true;
            else if (this.agentSpeaking) {
              this.agentSpeaking = false;
              this.agentDone?.();
            }
          },
        };
        const conv = agent.signedUrl
          ? await Conversation.startSession({ ...common, signedUrl: agent.signedUrl, connectionType: 'websocket' })
          : await Conversation.startSession({ ...common, agentId: agent.agentId, connectionType: 'websocket' });
        return conv as AgentConversation;
      } catch (e) {
        // Agent unavailable (mic denied, network): fall back to text on this press.
        this.set({ phase: 'text', mode: 'text', error: (e as Error).message });
        return null;
      }
    })();
  }

  private startRecognition(Rec: RecognitionCtor): void {
    const r = new Rec();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;
    this.transcript = '';
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i]![0]?.transcript ?? '';
      this.transcript = text;
      this.set({ transcript: text });
    };
    this.recognitionEnded = new Promise((res) => {
      r.onend = () => res();
    });
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.recognition = null;
        this.set({ phase: 'text', mode: 'text', error: 'Microphone blocked — type instead' });
      }
    };
    this.recognition = r;
    this.set({ phase: 'listening', mode: 'speech' });
    try {
      r.start();
    } catch {
      this.set({ phase: 'text', mode: 'text' });
    }
  }
}
