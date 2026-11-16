import type { AnnouncerLine } from '@huddle/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createAnnouncerQueue, stopAnnouncer, unlockAudio } from '../lib/audio';
import { useApp } from '../lib/session';
import { cx, useNow, useParty } from './ctx';
import { Icon } from './Icon';

const CAPTION_MS = 7000;

/** Plays new announcer lines when the speaker is on; returns the line currently speaking. */
export function useAnnouncer(speakerOn: boolean): AnnouncerLine | null {
  const { client, snap } = useParty();
  const [speaking, setSpeaking] = useState<AnnouncerLine | null>(null);
  const queue = useRef<ReturnType<typeof createAnnouncerQueue> | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    queue.current = createAnnouncerQueue(() => client.now(), setSpeaking);
    return () => {
      queue.current?.clear();
      stopAnnouncer();
    };
  }, [client]);

  useEffect(() => {
    if (!speakerOn) {
      queue.current?.clear();
      stopAnnouncer();
    }
  }, [speakerOn]);

  // iOS needs a gesture before audio: unlock on the first tap anywhere when the speaker is on.
  useEffect(() => {
    if (!speakerOn) return;
    const once = () => unlockAudio();
    window.addEventListener('pointerdown', once, { once: true });
    return () => window.removeEventListener('pointerdown', once);
  }, [speakerOn]);

  useEffect(() => {
    const lines = snap.announcer;
    if (!seen.current) {
      // First snapshot: don't replay history, except a line from the last few seconds.
      seen.current = new Set(lines.map((l) => l.id));
      const last = lines[lines.length - 1];
      if (last && speakerOn && client.now() - Date.parse(last.createdAt) < 4000) queue.current?.push(last);
      return;
    }
    for (const l of lines) {
      if (seen.current.has(l.id)) continue;
      seen.current.add(l.id);
      if (speakerOn) queue.current?.push(l);
    }
  }, [snap.announcer, speakerOn, client]);

  return speaking;
}

/** Caption toasts (every announcer line, PRD section 13) plus app notices, above the tab bar. */
export function Captions({ speaking }: { speaking: AnnouncerLine | null }) {
  const { snap } = useParty();
  const now = useNow(500);
  const notices = useApp((s) => s.notices);
  const dismiss = useApp((s) => s.dismiss);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const lines = snap.announcer
    .filter((l) => !hidden.has(l.id) && (l.id === speaking?.id || now - Date.parse(l.createdAt) < CAPTION_MS))
    .slice(-2);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-30 mx-auto flex max-w-xl flex-col gap-2 pl-3 pr-[88px]">
      <AnimatePresence initial={false}>
        {lines.map((l) => (
          <motion.button
            layout
            key={l.id}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => setHidden(new Set(hidden).add(l.id))}
            className={cx(
              'pointer-events-auto flex items-start gap-2.5 rounded-2xl border bg-pitch-900/95 px-3 py-2.5 text-left shadow-card backdrop-blur',
              l.id === speaking?.id ? 'border-volt/50' : 'border-pitch-700',
            )}
            aria-live="polite"
          >
            <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', l.id === speaking?.id ? 'bg-volt text-volt-ink' : 'bg-pitch-700 text-pitch-200')}>
              <Icon name="speaker" size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-pitch-400">Announcer</span>
              <span className="block text-[15px] leading-snug text-pitch-50">{l.text}</span>
            </span>
          </motion.button>
        ))}
        {notices.map((n) => (
          <motion.button
            layout
            key={`n${n.id}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => dismiss(n.id)}
            className={cx(
              'pointer-events-auto flex items-center gap-2 self-start rounded-full px-4 py-2.5 text-sm font-semibold shadow-card',
              n.tone === 'win' && 'bg-volt text-volt-ink',
              n.tone === 'loss' && 'bg-down text-down-ink',
              n.tone === 'error' && 'bg-pitch-700 text-down',
              n.tone === 'info' && 'bg-pitch-700 text-pitch-50',
            )}
            role="status"
          >
            <Icon name={n.tone === 'error' ? 'x' : 'check'} size={16} />
            {n.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
