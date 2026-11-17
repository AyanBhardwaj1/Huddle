import type { AgentSession, CreatePartyRequest, CreatePartyResponse, GameInfo, Party } from '@huddle/shared';
import { engineBase } from './config';

/** GET /health. Provider values are engine-defined; we read them defensively (see health.ts). */
export interface HealthResponse {
  ok: boolean;
  version?: string;
  settlement?: unknown;
  providers?: { sports?: unknown; gemini?: unknown; announcer?: unknown; llm?: unknown };
}

async function json<T>(path: string, init?: RequestInit, timeoutMs = 6000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(engineBase() + path, {
      ...init,
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) {
      const msg = (body as { error?: { message?: string } | string }).error ?? `${res.status} ${res.statusText}`;
      throw new Error(typeof msg === 'string' ? msg : (msg.message ?? `HTTP ${res.status}`));
    }
    return body as T;
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  // Long enough to ride out a hosted engine waking from sleep (Render free plan: up to ~1 min).
  health: () => json<HealthResponse>('/health', undefined, 25_000),
  games: (sport?: string) =>
    json<{ games: GameInfo[] }>(`/games${sport ? `?sport=${encodeURIComponent(sport)}` : ''}`).then((r) => r.games ?? []),
  parties: () => json<{ parties: Party[] }>('/parties').then((r) => r.parties ?? []),
  createParty: (body: CreatePartyRequest) => json<CreatePartyResponse>('/parties', { method: 'POST', body: JSON.stringify(body) }),
  /** ElevenLabs agent session for TALK, or null when no agent is configured. */
  agentSession: async (partyCode: string): Promise<AgentSession | null> => {
    const r = await json<AgentSession | { agent: null }>(`/agent/session?party=${encodeURIComponent(partyCode)}`);
    return 'agentId' in r && r.agentId ? r : null;
  },
};
