/** The kiosk's party, persisted so a reload (or a Pi reboot) resumes it. */
export interface BoxSession {
  partyCode: string;
  hostToken: string;
}

const KEY = 'huddle.box.session';

export function loadSession(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): BoxSession | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<BoxSession>;
    if (typeof s.partyCode === 'string' && typeof s.hostToken === 'string' && s.partyCode && s.hostToken) {
      return { partyCode: s.partyCode, hostToken: s.hostToken };
    }
  } catch {}
  return null;
}

export function saveSession(s: BoxSession | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage()): void {
  try {
    if (s) storage?.setItem(KEY, JSON.stringify(s));
    else storage?.removeItem(KEY);
  } catch {}
}

/**
 * Launcher handoff (used by `pnpm demo` and the e2e test): `/box/#party=CODE&host=TOKEN` adopts that
 * party as the kiosk session, saves it like a normal session, and strips the fragment from the
 * address bar. The fragment is never sent to the server, so the host token stays out of request logs.
 */
export function takeSessionFromUrl(
  loc: Pick<Location, 'hash'> | undefined = typeof window === 'undefined' ? undefined : window.location,
  clear: () => void = () => {
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {}
  },
): BoxSession | null {
  if (!loc?.hash || loc.hash.length < 2) return null;
  const params = new URLSearchParams(loc.hash.slice(1));
  const partyCode = params.get('party')?.trim().toUpperCase();
  const hostToken = params.get('host')?.trim();
  if (!partyCode || !hostToken) return null;
  clear();
  return { partyCode, hostToken };
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
