import type { AgentSession } from '@huddle/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { getAgentSession } from '../lib/api';
import { buzz, HAPTIC } from '../lib/haptics';
import { act, cx, useParty } from './ctx';
import { Icon, Spinner } from './Icon';
import { InlineError } from './MarketCard';
import { Sheet } from './primitives';

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

export function TalkButton({ fixture }: { fixture: boolean }) {
  const { client, snap, me } = useParty();
  const [mode, setMode] = useState<Mode | null>(null);
  const [agent, setAgent] = useState<AgentSession | null>(null);
  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
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
      const session = fixture ? null : await getAgentSession(snap.party.code, me);
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
      setBubble(s || 'Listening…');
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
      setBubble('Listening…');
    } catch {
      rec.current = null;
    }
  };

  // ---------- ElevenLabs agent
  const startAgent = async () => {
    if (idle.current) clearTimeout(idle.current);
    if (conv.current) {
      conv.current.setMicMuted(false);
      setBubble('Listening…');
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
      if (held.current) setBubble('Listening…');
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

  return (
    <>
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] right-0 z-30 w-full">
        <div className="relative mx-auto max-w-xl">
          <AnimatePresence>
            {bubble && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-[74px] right-4 max-w-[78%] rounded-2xl rounded-br-sm bg-pitch-50 px-3.5 py-2 text-[15px] text-pitch-950 shadow-card"
              >
                {bubble}
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              press();
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onContextMenu={(e) => e.preventDefault()}
            className={cx(
              'absolute bottom-0 right-4 grid h-16 w-16 select-none place-items-center rounded-full shadow-card transition-transform [-webkit-touch-callout:none]',
              holding ? 'scale-110 bg-volt text-volt-ink' : 'bg-pitch-800 text-volt ring-1 ring-volt/40',
            )}
            style={{ touchAction: 'none' }}
            aria-label={mode === 'text' ? 'Ask the announcer' : 'Hold to talk to the announcer'}
          >
            {holding && <span className="absolute inset-0 rounded-full border-2 border-volt animate-pulse-ring" />}
            {busy ? <Spinner size={24} /> : <Icon name="mic" size={28} />}
          </button>
        </div>
      </div>
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
          placeholder="What are the odds Portugal hits seven?"
          className="h-14 w-full rounded-2xl border border-pitch-700 bg-pitch-800 px-4 text-base text-pitch-50 placeholder:text-pitch-400 focus:border-volt focus:outline-none"
          enterKeyHint="send"
          autoFocus
        />
        <p className="text-xs text-pitch-400">Try “put 5 on yes”: the announcer drafts it and you confirm.</p>
        <button type="submit" className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-volt font-display text-xl font-bold uppercase text-volt-ink">
          <Icon name="send" size={18} /> Ask
        </button>
        {error && <InlineError text={error} />}
      </form>
    </Sheet>
  );
}
