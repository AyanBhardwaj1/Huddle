import {
  HuddleClient,
  type ClientRequest,
  type ClientView,
  type KeyPair,
} from '@huddle/shared';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { engineWsUrl } from './config';
import { browserKv, loadLastSigned, loadName, loadOrCreateWallet, saveLastSigned, saveName, type Kv } from './wallet';

/** What the screens need from a party connection. `HuddleClient` satisfies it; so does the fixture. */
export interface PartyClient {
  getView(): ClientView;
  subscribe(fn: () => void): () => void;
  now(): number;
  request(body: ClientRequest): Promise<Record<string, unknown>>;
  buyIn(amount: number): Promise<void>;
  close(): void;
}

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'win' | 'loss' | 'error';
}

interface AppState {
  path: string;
  booted: boolean;
  kv: Kv | null;
  wallet: KeyPair | null;
  name: string | null;
  client: PartyClient | null;
  partyCode: string | null;
  remote: boolean;
  fixture: boolean;
  /** null = not chosen yet: defaults to on for remote players, off in the room. */
  speakerPref: boolean | null;
  notices: Notice[];
  boot(): Promise<void>;
  navigate(path: string, replace?: boolean): void;
  setName(name: string): Promise<void>;
  connect(code: string, remote: boolean): Promise<void>;
  startFixture(client: PartyClient): void;
  disconnect(): void;
  setSpeaker(on: boolean): void;
  notify(text: string, tone?: Notice['tone']): void;
  dismiss(id: number): void;
}

/**
 * A player connection whose countersigned states persist per party, so co-signing survives reloads
 * (the next state must chain from the last one this phone signed).
 */
export async function createPlayerClient(o: {
  kv: Kv;
  wallet: KeyPair;
  name: string;
  code: string;
  remote: boolean;
  url: string;
  WebSocketCtor?: typeof WebSocket;
}): Promise<HuddleClient> {
  const code = o.code.toUpperCase();
  const lastSigned = await loadLastSigned(o.kv, code, o.wallet.publicKey);
  return new HuddleClient({
    url: o.url,
    partyCode: code,
    role: 'player',
    keyPair: o.wallet,
    name: o.name,
    remote: o.remote,
    lastSigned,
    onLastSigned: (s) => void saveLastSigned(o.kv, code, s),
    WebSocketCtor: o.WebSocketCtor,
  });
}

let noticeId = 0;
/** Party code a connect() is in flight for (guards double-connects from effects + forms). */
let connecting: string | null = null;

export const useApp = create<AppState>((set, get) => ({
  path: typeof window !== 'undefined' ? window.location.pathname : '/',
  booted: false,
  kv: null,
  wallet: null,
  name: null,
  client: null,
  partyCode: null,
  remote: false,
  fixture: false,
  speakerPref: null,
  notices: [],

  async boot() {
    if (get().booted) return;
    const kv = await browserKv();
    const [wallet, name, speaker] = await Promise.all([
      loadOrCreateWallet(kv),
      loadName(kv),
      kv.get<boolean>('huddle:speaker').catch(() => undefined),
    ]);
    set({ kv, wallet, name, booted: true, speakerPref: typeof speaker === 'boolean' ? speaker : null });
  },

  navigate(path, replace = false) {
    if (path === get().path) return;
    if (replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
    set({ path });
    window.scrollTo(0, 0);
  },

  async setName(name) {
    const kv = get().kv;
    if (!kv) return;
    set({ name: await saveName(kv, name) });
  },

  async connect(code, remote) {
    const { kv, wallet, name, client: old, partyCode } = get();
    if (!kv || !wallet || !name) throw new Error('not ready');
    const upper = code.toUpperCase();
    if ((old && partyCode === upper) || connecting === upper) return;
    connecting = upper;
    try {
      old?.close();
      const client = await createPlayerClient({ kv, wallet, name, code: upper, remote, url: engineWsUrl() });
      set({ client, partyCode: upper, remote });
      client.connect();
    } finally {
      connecting = null;
    }
  },

  startFixture(client) {
    set({ client, fixture: true, partyCode: 'DEMO', booted: true, name: 'You' });
  },

  disconnect() {
    get().client?.close();
    set({ client: null, partyCode: null });
  },

  setSpeaker(on) {
    set({ speakerPref: on });
    void get().kv?.set('huddle:speaker', on).catch(() => {});
  },

  notify(text, tone = 'info') {
    const id = ++noticeId;
    set({ notices: [...get().notices.slice(-2), { id, text, tone }] });
    setTimeout(() => get().dismiss(id), tone === 'error' ? 4500 : 3200);
  },

  dismiss(id) {
    set({ notices: get().notices.filter((n) => n.id !== id) });
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => useApp.setState({ path: window.location.pathname }));
}

const EMPTY_VIEW: ClientView = {
  status: 'idle',
  snapshot: null,
  lastSigned: null,
  cosignMismatch: null,
  lastError: null,
  lastGameEvent: null,
  chainEvents: [],
  led: null,
  clockSkewMs: 0,
};
const noopSubscribe = () => () => {};
const emptyView = () => EMPTY_VIEW;

/** The live, reduced party view from the current client. */
export function useView(client: PartyClient | null): ClientView {
  const get = client ? client.getView : emptyView;
  return useSyncExternalStore(client ? client.subscribe : noopSubscribe, get, get);
}
