import type { AgentSession, GameInfo, Party, PlayerPublic } from '@huddle/shared';
import { engineUrl } from './config';

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(engineUrl(path), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function listParties(): Promise<{ parties: Party[] }> {
  return getJson('/parties');
}

export interface PartyPreview {
  party: Party;
  players: PlayerPublic[];
  game?: GameInfo | unknown;
}

export function getParty(code: string): Promise<PartyPreview> {
  return getJson(`/parties/${encodeURIComponent(code.toUpperCase())}`);
}

/** Devnet test funds before a buy-in; a harmless no-op in points mode. Never throws. */
export async function requestFaucet(wallet: string): Promise<{ ok: boolean; amount?: number; txSig?: string }> {
  try {
    return await getJson('/faucet', { method: 'POST', body: JSON.stringify({ wallet }) });
  } catch {
    return { ok: false };
  }
}

/** ElevenLabs agent session for the talk button, or null when the engine has no agent configured. */
export async function getAgentSession(party: string, player: string): Promise<AgentSession | null> {
  try {
    const q = new URLSearchParams({ party, player });
    const data = await getJson<AgentSession | { agent: null }>(`/agent/session?${q.toString()}`);
    return 'agentId' in data && data.agentId ? data : null;
  } catch {
    return null;
  }
}
