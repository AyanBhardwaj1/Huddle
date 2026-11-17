import type { AgentSession } from '@huddle/shared';
import { Icon, Mark } from '@huddle/ui';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { fixtureVariant } from '../fixture';
import { getAgentSession } from '../lib/api';
import { buzz, HAPTIC } from '../lib/haptics';
import { act, cx, useParty, useUi } from './ctx';
import { InlineError, Sheet } from './primitives';

/**
 * TALK (PRD Flow E, D12): hold to talk.
 *  1. ElevenLabs Agent when the engine has one (`GET /agent/session`),
 *  2. else browser speech recognition -> `talk_text`,
 *  3. else a small text box -> `talk_text`.
 * Answers come back as announcer lines (captions); bet requests come back as drafts to confirm.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function speechCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Mode = 'agent' | 'speech' | 'text';
type VoiceConv = { setMicMuted(m: boolean): void; endSession(): Promise<void> };

const LISTENING = 'Listening…';

export function TalkButton({ fixture }: { fixture: boolean }) {
  const { client, snap, me } = useParty();
  const [mode, setMode] = useState<Mode | null>(null);
  const [agent, setAgent] = useState<AgentSession | null>(null);
  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const setTalk = useUi((st) => st.setTalk);
  const setBubble = (text: string | null) => setTalk(text === null ? null : { text, listening: text === LISTENING });
  const [textOpen, setTextOpen] = useState(false);
  const held = useRef(false);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const transcript = useRef('');
  const conv = useRef<VoiceConv | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = fixture || fixtureVariant() ? null : await getAgentSession(snap.party.code, me);
      if (cancelled) return;
      setAgent(session);
      setMode(session ? 'agent' : speechCtor() ? 'speech' : 'text');
    })();
    return () => {
      cancelled = true;
    };
  }, [fixture, snap.party.code, me]);

  useEffect(
    () => () => {
      rec.current?.abort();
      void conv.current?.endSession().catch(() => {});
      if (idle.current) clearTimeout(idle.current);
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      useUi.getState().setTalk(null);
    },
    [],
  );

  const flash = (text: string, ms = 3500) => {
    setBubble(text);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    flash(`“${t}”`);
    const err = await act(client, { type: 'talk_text', text: t.slice(0, 300) });
    if (err) flash(err);
  };

  // ---------- speech recognition
  const startSpeech = () => {
    const Ctor = speechCtor();
    if (!Ctor) return setMode('text');
    transcript.current = '';
    const r = new Ctor();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let s = '';
      for (let i = 0; i < e.results.length; i++) s += e.results[i]![0]!.transcript;
      transcript.current = s;
      setBubble(s || LISTENING);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setMode('text');
        flash('Mic is blocked. Type your question instead.');
      }
    };
    r.onend = () => {
      rec.current = null;
      const said = transcript.current;
      if (said) void send(said);
      else setBubble(null);
    };
    rec.current = r;
    try {
      r.start();
      setBubble(LISTENING);
    } catch {
      rec.current = null;
    }
  };

  // ---------- ElevenLabs agent
  const startAgent = async () => {
    if (idle.current) clearTimeout(idle.current);
    if (conv.current) {
      conv.current.setMicMuted(false);
      setBubble(LISTENING);
      return;
    }
    if (!agent) return;
    setBusy(true);
    try {
      const { Conversation } = await import('@elevenlabs/client');
      const base = agent.signedUrl ? { signedUrl: agent.signedUrl } : { agentId: agent.agentId };
      const c = (await Conversation.startSession({
        ...base,
        dynamicVariables: agent.dynamicVariables,
        onMessage: ({ message, source }: { message: string; source: string }) => {
          if (source === 'ai') flash(message, 6000);
        },
        onDisconnect: () => {
          conv.current = null;
        },
        onError: () => flash("The announcer couldn't hear you. Try again."),
      } as Parameters<typeof Conversation.startSession>[0])) as unknown as VoiceConv;
      conv.current = c;
      if (held.current) setBubble(LISTENING);
      else muteAndIdle();
    } catch {
      // No mic permission or no network: fall back to on-device recognition.
      setMode(speechCtor() ? 'speech' : 'text');
      flash('Voice chat is unavailable. Using the basic mic.');
    } finally {
      setBusy(false);
    }
  };

  const muteAndIdle = () => {
    conv.current?.setMicMuted(true);
    setBubble(null);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      void conv.current?.endSession().catch(() => {});
      conv.current = null;
    }, 25_000);
  };

  const press = () => {
    if (mode === 'text' || !mode) return setTextOpen(true);
    buzz(HAPTIC.tap);
    held.current = true;
    setHolding(true);
    if (mode === 'speech') startSpeech();
    else void startAgent();
  };

  const release = () => {
    if (!held.current) return;
    held.current = false;
    setHolding(false);
    if (mode === 'speech') rec.current?.stop();
    if (mode === 'agent' && conv.current) muteAndIdle();
  };

  const keyDown = (e: ReactKeyboardEvent) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      press();
    }
  };
  const keyUp = (e: ReactKeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') release();
  };

  return (
    <>
      <button
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={keyDown}
        onKeyUp={keyUp}
        onContextMenu={(e) => e.preventDefault()}
        className={cx(
          'relative grid h-16 w-16 shrink-0 select-none place-items-center rounded-full bg-prime text-white shadow-zap [-webkit-touch-callout:none]',
          'transition-transform duration-[480ms] ease-spring',
          holding ? 'scale-[1.06]' : 'hover:-translate-y-0.5 active:scale-95',
        )}
        style={{ touchAction: 'none' }}
        aria-label={mode === 'text' ? 'Ask the announcer' : 'Hold to talk to the announcer'}
        aria-pressed={mode === 'text' ? undefined : holding}
      >
        {holding && (
          <>
            <span className="pl-listen absolute inset-0 rounded-full border-2 border-zap" aria-hidden="true" />
            <span className="pl-listen absolute inset-0 rounded-full border-2 border-zap" style={{ ['--d' as string]: '700ms' }} aria-hidden="true" />
          </>
        )}
        {busy ? <Mark size="1.7rem" spin lit={3} className="text-white/50" /> : <Icon name="mic" size={28} />}
      </button>
      <TextAsk open={textOpen} onClose={() => setTextOpen(false)} onSend={send} />
    </>
  );
}

function TextAsk({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (t: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Ask the announcer">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return setError('Type a question first.');
          await onSend(text);
          setText('');
          onClose();
        }}
      >
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          maxLength={300}
          placeholder="What are the odds Portugal scores again?"
          className="field h-14"
          aria-label="Your question"
          name="question"
          autoComplete="off"
          enterKeyHint="send"
        />
        <p className="text-small text-ink-muted">Try “put 5 on yes”: the announcer drafts it and you confirm.</p>
        <button type="submit" className="btn-primary w-full">
          <Icon name="send" size={18} /> Ask the announcer
        </button>
        {error && <InlineError text={error} />}
      </form>
    </Sheet>
  );
}
