import { HuddleClient, RequestError, type AnnouncerLine, type ClientRequest, type ClientView, type HostAction } from '@huddle/shared';
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AnnouncerPlayer } from './lib/announcer';
import { api } from './lib/api';
import { engineWsUrl } from './lib/config';
import type { BoxSession } from './lib/session';
import { TalkController } from './lib/talk';
import { useBox } from './store';

export interface PartyApi {
  view: ClientView;
  /** Engine time, ms. */
  now: () => number;
  /** Send a host action; toasts the error and resolves false when the engine refuses. */
  act: (a: HostAction, okText?: string) => Promise<boolean>;
  request: (body: ClientRequest) => Promise<unknown>;
  talk: Pick<TalkController, 'press' | 'release' | 'sendText' | 'cancelText'> | null;
  fixture: boolean;
}

const Ctx = createContext<PartyApi | null>(null);

export function useParty(): PartyApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useParty outside a party provider');
  return v;
}
export const useOptionalParty = () => useContext(Ctx);

/** Re-render on an interval and return engine time (for countdowns). */
export function useNow(intervalMs = 250): number {
  const party = useOptionalParty();
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return party ? party.now() : Date.now();
}

const ACTION_OK: Partial<Record<HostAction['action'], string>> = {
  lock: 'Locked',
  resolve: 'Result set',
  void: 'Voided — stakes refunded',
  approve_draft: 'Question opened',
  discard_draft: 'Draft discarded',
  confirm_result: 'Result confirmed',
  set_mode: 'Mode switched',
  create_market: 'Question opened',
  end_party: 'Ending the party',
};

const IDLE_VIEW: ClientView = {
  status: 'connecting',
  snapshot: null,
  lastSigned: null,
  cosignMismatch: null,
  lastError: null,
  lastGameEvent: null,
  chainEvents: [],
  led: null,
  clockSkewMs: 0,
};
const idleView = () => IDLE_VIEW;
const noopSubscribe = () => () => {};

function errorText(e: unknown): string {
  if (e instanceof RequestError) return e.error.message || e.code;
  return e instanceof Error ? e.message : String(e);
}

/** Live engine connection for the kiosk's party. */
export function LivePartyProvider({ session, children }: { session: BoxSession; children: ReactNode }) {
  const setSpeaking = useBox((s) => s.setSpeaking);
  const soundEnabled = useBox((s) => s.soundEnabled);
  const setTalk = useBox((s) => s.setTalk);
  const showToast = useBox((s) => s.showToast);
  const playerRef = useRef<AnnouncerPlayer | null>(null);

  // One client per effect run (not useMemo): HuddleClient is not safe to close() and then connect()
  // again, which React StrictMode's mount/unmount/mount would otherwise do.
  const [client, setClient] = useState<HuddleClient | null>(null);
  useEffect(() => {
    const c = new HuddleClient({
      url: engineWsUrl(),
      partyCode: session.partyCode,
      role: 'box',
      hostToken: session.hostToken,
      autoCosign: false,
      onAnnouncer: (line: AnnouncerLine) => playerRef.current?.push(line),
    });
    c.connect();
    setClient(c);
    return () => {
      c.close();
      setClient(null);
    };
  }, [session.partyCode, session.hostToken]);

  useEffect(() => {
    const player = new AnnouncerPlayer(setSpeaking);
    playerRef.current = player;
    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [setSpeaking]);

  useEffect(() => {
    playerRef.current?.setEnabled(soundEnabled);
  }, [soundEnabled]);

  const clientRef = useRef<HuddleClient | null>(null);
  clientRef.current = client;
  const request = useMemo(
    () => (b: ClientRequest) => (clientRef.current ? clientRef.current.request(b) : Promise.reject(new Error('not connected'))),
    [],
  );

  const talk = useMemo(
    () =>
      new TalkController({
        partyCode: session.partyCode,
        request,
        getAgent: (code) => api.agentSession(code),
        onState: setTalk,
        onPress: () => playerRef.current?.interrupt(),
      }),
    [request, session.partyCode, setTalk],
  );
  useEffect(() => () => talk.dispose(), [talk]);

  const view = useSyncExternalStore(client?.subscribe ?? noopSubscribe, client?.getView ?? idleView);

  const api_: PartyApi = useMemo(
    () => ({
      view,
      now: () => clientRef.current?.now() ?? Date.now(),
      request,
      act: async (action, okText) => {
        try {
          await request({ type: 'host_action', action });
          const msg = okText ?? ACTION_OK[action.action];
          if (msg) showToast(msg, 'ok');
          return true;
        } catch (e) {
          showToast(errorText(e), 'error');
          return false;
        }
      },
      talk,
      fixture: false,
    }),
    [view, request, talk, showToast],
  );
  return <Ctx.Provider value={api_}>{children}</Ctx.Provider>;
}

/** Static provider for `?fixture=…` review mode: host actions only toast. */
export function StaticPartyProvider({ view, children }: { view: ClientView; children: ReactNode }) {
  const showToast = useBox((s) => s.showToast);
  const setTalk = useBox((s) => s.setTalk);
  const value: PartyApi = useMemo(
    () => ({
      view,
      now: () => Date.now(),
      request: async (b) => {
        if (b.type === 'talk_text') showToast(`(fixture) asked: ${b.text}`, 'info');
        return {};
      },
      act: async (a) => {
        showToast(`(fixture) host_action ${a.action}`, 'info');
        return true;
      },
      talk: {
        press: async () =>
          setTalk({ phase: 'listening', mode: 'speech', transcript: 'What are the odds Portugal hits seven?', error: null }),
        release: async () => setTalk({ phase: 'idle', mode: null, transcript: '', error: null }),
        sendText: async () => setTalk({ phase: 'idle', mode: null, transcript: '', error: null }),
        cancelText: () => setTalk({ phase: 'idle', mode: null, transcript: '', error: null }),
      },
      fixture: true,
    }),
    [view, showToast, setTalk],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
