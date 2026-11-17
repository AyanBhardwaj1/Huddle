import type { AnnouncerLine } from '@huddle/shared';
import { Icon } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';
import { createAnnouncerQueue, stopAnnouncer, unlockAudio } from '../lib/audio';
import { useApp } from '../lib/session';
import { cx, useNow, useParty, useUi } from './ctx';
import { Empty, Sheet } from './primitives';

const CAPTION_MS = 7000;
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

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

type Slot =
  | { key: string; kind: 'talk'; text: string; listening: boolean }
  | { key: string; kind: 'notice'; text: string; tone: 'info' | 'win' | 'loss' | 'error'; id: number }
  | { key: string; kind: 'line'; text: string; fresh: boolean; speaking: boolean };

/**
 * The caption slot: one line at a time, in a fixed place above the tab bar, left of the mic.
 * Talk > your notices > the announcer. The latest announcer line rests there dimmed; tap it for
 * everything said tonight. Nothing ever stacks over the cards or the mic.
 */
export function Captions({ speaking }: { speaking: AnnouncerLine | null }) {
  const { snap } = useParty();
  const now = useNow(500);
  const notices = useApp((s) => s.notices);
  const dismiss = useApp((s) => s.dismiss);
  const talk = useUi((s) => s.talk);
  const setHistory = useUi((s) => s.setHistory);
  const last = speaking ?? snap.announcer[snap.announcer.length - 1];
  const notice = notices[notices.length - 1];

  let slot: Slot | null = null;
  if (talk) slot = { key: `t${talk.listening ? 'l' : talk.text}`, kind: 'talk', ...talk };
  else if (notice) slot = { key: `n${notice.id}`, kind: 'notice', text: notice.text, tone: notice.tone, id: notice.id };
  else if (last)
    slot = {
      key: `a${last.id}`,
      kind: 'line',
      text: last.text,
      speaking: last.id === speaking?.id,
      fresh: last.id === speaking?.id || now - Date.parse(last.createdAt) < CAPTION_MS,
    };

  return (
    <div className="min-w-0 flex-1" aria-live="polite" aria-atomic="true">
      {!slot && (
        <p className="flex h-14 items-center px-1 text-small text-ink-muted">The announcer's lines show up here. Hold the mic to ask anything.</p>
      )}
      {slot?.kind === 'talk' && (
        <div key={slot.key} className="pl-caption flex h-14 items-center gap-3 rounded-tile bg-well px-3.5">
          <Icon name="mic" size={18} className="shrink-0 text-zap" />
          <span className="line-clamp-2 min-w-0 text-small leading-snug text-ink">{slot.listening ? 'Listening… let go to send' : slot.text}</span>
        </div>
      )}
      {slot?.kind === 'notice' && (
        <button
          key={slot.key}
          onClick={() => dismiss(slot.id)}
          className={cx(
            'pl-caption flex h-14 w-full items-center gap-3 rounded-tile px-3.5 text-left',
            slot.tone === 'error' ? 'bg-no-50' : 'bg-well',
          )}
        >
          <Icon
            name={slot.tone === 'error' ? 'warn' : 'check'}
            size={18}
            strokeWidth={2.4}
            className={cx('shrink-0', slot.tone === 'error' ? 'text-no-600' : slot.tone === 'loss' ? 'text-no-600' : 'text-zap')}
          />
          <span className="line-clamp-2 min-w-0 text-small font-semibold leading-snug text-ink">{slot.text}</span>
          <span className="hd-sr">Dismiss</span>
        </button>
      )}
      {slot?.kind === 'line' && (
        <button
          key={slot.key}
          onClick={() => setHistory(true)}
          className="pl-caption flex h-14 w-full items-center gap-3 rounded-tile bg-card px-3.5 text-left transition-colors duration-quick hover:bg-well"
          aria-label={`Announcer: ${slot.text}. Show everything the announcer said`}
        >
          <Icon name="speaker" size={18} className={cx('shrink-0 transition-colors duration-base', slot.speaking ? 'text-zap' : 'text-ink-muted')} />
          <span
            className={cx(
              'line-clamp-2 min-w-0 text-small leading-snug transition-colors duration-linger',
              slot.fresh ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {slot.text}
          </span>
        </button>
      )}
    </div>
  );
}

/** Everything the announcer said tonight, newest first (opened from the caption slot). */
export function CaptionHistory() {
  const { snap } = useParty();
  const open = useUi((s) => s.historyOpen);
  const setOpen = useUi((s) => s.setHistory);
  const lines = [...snap.announcer].reverse();
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="The announcer">
      {lines.length ? (
        <ol className="divide-y divide-rule">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-3 py-3">
              <time className="w-12 shrink-0 pt-0.5 text-cap text-ink-muted tnum" dateTime={l.createdAt}>
                {TIME.format(new Date(l.createdAt))}
              </time>
              <p className="min-w-0 text-pretty text-body text-ink">{l.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>The announcer calls every question, result and big trade. Their lines show up here.</Empty>
      )}
    </Sheet>
  );
}
