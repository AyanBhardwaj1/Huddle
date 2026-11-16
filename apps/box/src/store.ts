import type { AnnouncerLine } from '@huddle/shared';
import { create } from 'zustand';
import type { BoardView } from './lib/derive';
import { loadSession, saveSession, takeSessionFromUrl, type BoxSession } from './lib/session';
import { IDLE_TALK, type TalkState } from './lib/talk';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}

interface BoxStore {
  session: BoxSession | null;
  setSession: (s: BoxSession | null) => void;
  /** Pre-party screen. */
  screen: 'home' | 'create';
  setScreen: (s: 'home' | 'create') => void;
  /** Party screens overlay, cycled by NEXT. */
  view: BoardView;
  setView: (v: BoardView) => void;
  soundEnabled: boolean;
  setSoundEnabled: (on: boolean) => void;
  speaking: AnnouncerLine | null;
  setSpeaking: (l: AnnouncerLine | null) => void;
  talk: TalkState;
  setTalk: (t: TalkState) => void;
  bridgeConnected: boolean;
  setBridgeConnected: (c: boolean) => void;
  toast: Toast | null;
  showToast: (text: string, tone?: Toast['tone']) => void;
}

let toastSeq = 0;

/** A launcher handoff in the URL fragment wins over the stored session (see takeSessionFromUrl). */
function initialSession(): BoxSession | null {
  const handoff = takeSessionFromUrl();
  if (handoff) saveSession(handoff);
  return handoff ?? loadSession();
}

export const useBox = create<BoxStore>((set) => ({
  session: initialSession(),
  setSession: (session) => {
    saveSession(session);
    set({ session, view: 'board' });
  },
  screen: 'home',
  setScreen: (screen) => set({ screen }),
  view: 'board',
  setView: (view) => set({ view }),
  soundEnabled: false,
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  speaking: null,
  setSpeaking: (speaking) => set({ speaking }),
  talk: IDLE_TALK,
  setTalk: (talk) => set({ talk }),
  bridgeConnected: false,
  setBridgeConnected: (bridgeConnected) => set({ bridgeConnected }),
  toast: null,
  showToast: (text, tone = 'info') => {
    const id = ++toastSeq;
    set({ toast: { id, text, tone } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), 3500);
  },
}));
