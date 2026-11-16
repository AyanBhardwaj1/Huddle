import { generateKeyPair, keyPairFromSecret, type BalanceState, type KeyPair } from '@huddle/shared';

/**
 * The invisible wallet (PRD section 8): an ed25519 keypair created on first launch and kept in
 * IndexedDB, plus the player's display name and the last countersigned balance per party so
 * co-signing survives reloads. Storage is injected so it can be unit-tested without a browser.
 */

export interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

interface StoredWallet {
  v: 1;
  publicKey: string;
  secretKey: number[];
}

const WALLET_KEY = 'huddle:wallet';
const NAME_KEY = 'huddle:name';
const signedKey = (party: string, member: string) => `huddle:signed:${party.toUpperCase()}:${member}`;

export async function loadOrCreateWallet(kv: Kv): Promise<KeyPair> {
  const stored = await kv.get<StoredWallet>(WALLET_KEY).catch(() => undefined);
  if (stored && Array.isArray(stored.secretKey) && stored.secretKey.length === 64) {
    try {
      const kp = keyPairFromSecret(Uint8Array.from(stored.secretKey));
      if (kp.publicKey === stored.publicKey) return kp;
    } catch {
      /* corrupt entry: fall through and replace it */
    }
  }
  const kp = generateKeyPair();
  const record: StoredWallet = { v: 1, publicKey: kp.publicKey, secretKey: Array.from(kp.secretKey) };
  await kv.set(WALLET_KEY, record);
  return kp;
}

export async function loadName(kv: Kv): Promise<string | null> {
  const n = await kv.get<string>(NAME_KEY).catch(() => undefined);
  return typeof n === 'string' && n.trim() ? n : null;
}

/** Display names are 1..24 chars (protocol limit); collapse whitespace. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 24);
}

export async function saveName(kv: Kv, name: string): Promise<string> {
  const clean = cleanName(name);
  if (!clean) throw new Error('name required');
  await kv.set(NAME_KEY, clean);
  return clean;
}

export async function loadLastSigned(kv: Kv, party: string, member: string): Promise<BalanceState | null> {
  const s = await kv.get<BalanceState>(signedKey(party, member)).catch(() => undefined);
  return s && typeof s.nonce === 'number' && s.member === member ? s : null;
}

/** Persist a countersigned state; never goes backwards (an older nonce is ignored). */
export async function saveLastSigned(kv: Kv, party: string, state: BalanceState): Promise<boolean> {
  const prev = await loadLastSigned(kv, party, state.member);
  if (prev && prev.nonce >= state.nonce) return false;
  await kv.set(signedKey(party, state.member), state);
  return true;
}

/** In-memory store (tests, and the fallback when IndexedDB is unavailable). */
export function memoryKv(): Kv {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => structuredClone(m.get(k)) as T | undefined,
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
  };
}

/** localStorage-backed store: used when IndexedDB is blocked (some private-browsing modes). */
export function localStorageKv(): Kv {
  return {
    get: async <T>(k: string) => {
      const raw = localStorage.getItem(k);
      return raw == null ? undefined : (JSON.parse(raw) as T);
    },
    set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    del: async (k) => localStorage.removeItem(k),
  };
}

/** IndexedDB first (idb-keyval), then localStorage, then memory. */
export async function browserKv(): Promise<Kv> {
  try {
    const idb = await import('idb-keyval');
    const probe = '__huddle_probe__';
    await idb.set(probe, 1);
    await idb.del(probe);
    return {
      get: <T>(k: string) => idb.get<T>(k),
      set: (k, v) => idb.set(k, v),
      del: (k) => idb.del(k),
    };
  } catch {
    try {
      localStorage.setItem('__huddle_probe__', '1');
      localStorage.removeItem('__huddle_probe__');
      return localStorageKv();
    } catch {
      return memoryKv();
    }
  }
}
