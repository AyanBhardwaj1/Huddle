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

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
