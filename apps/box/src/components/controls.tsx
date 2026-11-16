import { BridgeClient } from '@huddle/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { bridgeUrl } from '../lib/config';
import { nextView } from '../lib/derive';
import { audioAlreadyAllowed, unlockAudio } from '../lib/sfx';
import { useParty } from '../party';
import { useBox } from '../store';
import { Icon } from './ui';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/**
 * Physical + keyboard buttons. Keyboard: L = lock, hold T = talk, N = next.
 * Bridge (`VITE_BRIDGE_URL`): talk down/up and next down. The bridge LOCK button is handled by the
 * engine (it is also connected to the bridge), so the UI deliberately ignores it.
 */
export function useBoxInputs(): void {
  const party = useParty();
  const setBridgeConnected = useBox((s) => s.setBridgeConnected);
  const ref = useRef(party);
  ref.current = party;

  const next = () => {
    const { view, setView } = useBox.getState();
    setView(nextView(view));
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'l' && !e.repeat) void ref.current.act({ action: 'lock' });
      else if (k === 't' && !e.repeat) void ref.current.talk?.press();
      else if (k === 'n' && !e.repeat) next();
      else if (k === 'escape') useBox.getState().setView('board');
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 't' && !isTyping(e.target)) void ref.current.talk?.release();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    if (party.fixture) return;
    const bridge = new BridgeClient(bridgeUrl(), { onStatus: setBridgeConnected });
    const off = bridge.onEvent((e) => {
      if (e.type !== 'button') return;
      if (e.id === 'talk') void (e.action === 'down' ? ref.current.talk?.press() : ref.current.talk?.release());
      else if (e.id === 'next' && e.action === 'down') next();
      // 'lock' is the engine's job.
    });
    return () => {
      off();
      bridge.close();
      setBridgeConnected(false);
    };
  }, [party.fixture, setBridgeConnected]);
}

/** On-screen LOCK / TALK / host buttons (bottom-right, big touch targets). */
export function BoxButtons({ canLock }: { canLock: boolean }) {
  const { act, talk } = useParty();
  const view = useBox((s) => s.view);
  const setView = useBox((s) => s.setView);
  const t = useBox((s) => s.talk);
  const listening = t.phase === 'listening' || t.phase === 'connecting';
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        className={`btn min-h-[2.75rem] px-4 text-[1.2rem] ${canLock ? 'bg-live text-white' : 'bg-pitch-800 text-pitch-400 ring-1 ring-pitch-700'}`}
        disabled={!canLock}
        onClick={() => void act({ action: 'lock' })}
        aria-label="Lock the current market (L)"
      >
        <Icon name="lock" className="h-5 w-5" /> Lock
      </button>
      <button
        className={`btn min-h-[2.75rem] touch-none px-4 text-[1.2rem] ${listening ? 'bg-volt text-volt-ink shadow-glow' : 'bg-pitch-800 text-pitch-50 ring-1 ring-pitch-600'}`}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          void talk?.press();
        }}
        onPointerUp={() => void talk?.release()}
        onPointerCancel={() => void talk?.release()}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Hold to talk to the announcer (hold T)"
      >
        <Icon name="mic" className="h-5 w-5" /> {listening ? 'Listening' : 'Talk'}
      </button>
      <button
        className={`btn min-h-[2.75rem] px-3 ${view === 'host' ? 'bg-volt text-volt-ink' : 'bg-pitch-800 text-pitch-50 ring-1 ring-pitch-600'}`}
        onClick={() => setView(nextView(view))}
        aria-label="Next: host controls, scorecard, board (N)"
      >
        <Icon name={view === 'board' ? 'cog' : 'next'} className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Listening indicator + text fallback for TALK. */
export function TalkOverlay() {
  const t = useBox((s) => s.talk);
  const { talk } = useParty();
  const [text, setText] = useState('');
  const show = t.phase !== 'idle';
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="absolute bottom-[4.2rem] left-1/2 z-50 flex w-[40rem] max-w-[92vw] -translate-x-1/2 items-center gap-4 rounded-2xl bg-pitch-800 px-5 py-3 shadow-2xl ring-2 ring-volt"
          role="status"
        >
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-volt text-volt-ink">
            {t.phase === 'listening' && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-volt" />}
            <Icon name="mic" className="relative h-7 w-7" />
          </span>
          {t.phase === 'text' ? (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void talk?.sendText(text);
                setText('');
              }}
            >
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ask the announcer… (no microphone available)"
                className="h-12 min-w-0 flex-1 rounded-lg bg-pitch-900 px-3 text-[1.05rem] outline-none ring-1 ring-pitch-600 focus:ring-volt"
                maxLength={300}
              />
              <button className="btn-volt min-h-[3rem]" disabled={!text.trim()}>
                Ask
              </button>
              <button type="button" className="btn-ghost min-h-[3rem] px-3" onClick={() => talk?.cancelText()} aria-label="Cancel">
                <Icon name="x" className="h-5 w-5" />
              </button>
            </form>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="font-display text-[1.5rem] font-bold uppercase tracking-wide">
                {t.phase === 'connecting' ? 'Connecting…' : t.phase === 'sending' ? (t.mode === 'agent' ? 'Announcer answering…' : 'Asking…') : 'Listening — release to ask'}
              </div>
              <div className="truncate text-[1.05rem] text-pitch-200">{t.transcript || (t.mode === 'agent' ? 'Live voice with the announcer' : 'Try “What are the odds he scores?”')}</div>
              {t.error && <div className="text-[0.85rem] text-down">{t.error}</div>}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Browsers block audio until a gesture: one tap enables the announcer for this page load. */
export function SoundGate() {
  const enabled = useBox((s) => s.soundEnabled);
  const setEnabled = useBox((s) => s.setSoundEnabled);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (audioAlreadyAllowed()) void unlockAudio().then((ok) => ok && setEnabled(true));
    setChecked(true);
  }, [setEnabled]);
  if (enabled || !checked) return null;
  return (
    <button
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-pitch-950/80 backdrop-blur-sm"
      onClick={async () => {
        await unlockAudio();
        setEnabled(true);
      }}
    >
      <span className="flex h-28 w-28 items-center justify-center rounded-full bg-volt text-volt-ink shadow-glow">
        <Icon name="sound" className="h-14 w-14" />
      </span>
      <span className="font-display text-[3rem] font-bold uppercase tracking-wide">Tap to enable sound</span>
      <span className="text-[1.1rem] text-pitch-200">The announcer talks through this screen's speaker.</span>
    </button>
  );
}
