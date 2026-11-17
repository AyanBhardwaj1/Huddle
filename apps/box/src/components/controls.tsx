import { BridgeClient } from '@huddle/shared';
import { Mark } from '@huddle/ui';
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

const KEY = 'ml-0.5 hidden rounded-[4px] bg-black/20 px-1.5 py-0.5 font-display text-small font-bold lg:inline';

/**
 * On-screen LOCK / TALK / host buttons. LOCK only appears when there is something to lock (the
 * hardware button is always there); it is the one flood-lit control in the bar while it shows.
 */
export function BoxButtons({ canLock, showLock = true, compact = false }: { canLock: boolean; showLock?: boolean; compact?: boolean }) {
  const { act, talk } = useParty();
  const view = useBox((s) => s.view);
  const setView = useBox((s) => s.setView);
  const t = useBox((s) => s.talk);
  const listening = t.phase === 'listening' || t.phase === 'connecting';
  return (
    <div className="flex shrink-0 items-center gap-2">
      {showLock && (
        <button
          type="button"
          className={`${canLock ? 'btn-primary' : 'btn-secondary'} min-h-[2.75rem] px-4`}
          disabled={!canLock}
          onClick={() => void act({ action: 'lock' })}
          aria-label="Lock the current market (L)"
          aria-keyshortcuts="L"
        >
          <Icon name="lock" className="h-5 w-5" /> <span className={compact ? 'hd-sr' : ''}>Lock</span>
          {!compact && <kbd className={KEY}>L</kbd>}
        </button>
      )}
      <button
        type="button"
        className={`${listening ? 'btn-primary' : 'btn-secondary'} min-h-[2.75rem] touch-none px-4`}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          void talk?.press();
        }}
        onPointerUp={() => void talk?.release()}
        onPointerCancel={() => void talk?.release()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            void talk?.press();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') void talk?.release();
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Hold to talk to the announcer (hold T)"
        aria-keyshortcuts="T"
        aria-pressed={listening}
      >
        <Icon name="mic" className="h-5 w-5" /> <span className={compact ? 'hd-sr' : ''}>{listening ? 'Listening' : 'Talk'}</span>
      </button>
      <button
        type="button"
        className={`${view === 'host' ? 'btn-primary' : 'btn-secondary'} min-h-[2.75rem] px-3.5`}
        onClick={() => setView(nextView(view))}
        aria-label={view === 'board' ? 'Open host controls (N)' : view === 'host' ? 'Show the scorecard (N)' : 'Back to the board (N)'}
        aria-keyshortcuts="N"
        aria-expanded={view === 'host'}
        data-testid="host-controls-toggle"
      >
        <Icon name={view === 'board' ? 'settings' : view === 'host' ? 'chart' : 'x'} className="h-5 w-5" />
        <span className={compact ? 'hd-sr' : 'text-body'}>{view === 'board' ? 'Host' : view === 'host' ? 'Scores' : 'Board'}</span>
      </button>
    </div>
  );
}

/** Listening indicator + text fallback for TALK. */
export function TalkOverlay() {
  const t = useBox((s) => s.talk);
  const { talk } = useParty();
  const [text, setText] = useState('');
  if (t.phase === 'idle') return null;
  return (
    <div
      className="hd-rise absolute bottom-[4.25rem] left-1/2 z-talk flex w-[42rem] max-w-[92vw] -translate-x-1/2 items-center gap-4 rounded-panel bg-night-800 px-5 py-4 shadow-float ring-1 ring-inset ring-night-600"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-flood text-flood-ink">
        {t.phase === 'listening' && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-flood motion-reduce:hidden" />}
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
          <label htmlFor="talk-text" className="hd-sr">
            Ask the announcer
          </label>
          <input
            id="talk-text"
            name="talk-text"
            autoComplete="off"
            // Only shown after the host pressed TALK on a box with no microphone: focus is the point.
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What are the odds he scores…"
            className="h-12 min-w-0 flex-1 rounded-tile bg-night-900 px-4 text-lead text-chalk ring-1 ring-inset ring-night-600 placeholder:text-night-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flood"
            maxLength={300}
          />
          <button type="submit" className="btn-primary min-h-[3rem]" disabled={!text.trim()}>
            Ask
          </button>
          <button type="button" className="btn-secondary min-h-[3rem] px-3" onClick={() => talk?.cancelText()} aria-label="Cancel">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-title font-bold leading-tight">
            {t.phase === 'connecting'
              ? 'Connecting…'
              : t.phase === 'sending'
                ? t.mode === 'agent'
                  ? 'The announcer is answering…'
                  : 'Asking…'
                : 'Listening. Let go to ask.'}
          </p>
          <p className="truncate text-lead text-night-200">
            {t.transcript || (t.mode === 'agent' ? 'Live voice with the announcer' : 'Try “What are the odds he scores?”')}
          </p>
          {t.error && <p className="text-body text-no-bright">{t.error}</p>}
        </div>
      )}
    </div>
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
      type="button"
      data-testid="sound-gate"
      className="hd-fade fixed inset-0 z-gate flex flex-col items-center justify-center gap-5 bg-night-950/90 text-center"
      onClick={async () => {
        await unlockAudio();
        setEnabled(true);
      }}
    >
      <Mark size="9rem" lit={12} className="hd-breathe text-night-600" />
      <span className="q text-display">Tap to turn on the announcer</span>
      <span className="max-w-[36rem] text-lead text-night-200">
        The box calls every market out loud through this speaker. Browsers need one tap first.
      </span>
    </button>
  );
}
