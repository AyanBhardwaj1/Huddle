import type { AgentSession, Persona } from '@huddle/shared';
import { redact, type Env, type FetchLike, type Logger } from './log';
import { ELEVENLABS_BASE_URL, describeError } from './tts';

/**
 * ElevenLabs Agents session for the TALK button (PRD section 7, "Talk-back voice agent").
 *
 * Verified against the official API reference on 2026-11-16:
 *   GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=<id>
 *   header xi-api-key: <key>      ->  200 { "signed_url": "wss://..." }   (valid for 15 minutes)
 * The client starts the conversation with `Conversation.startSession({ signedUrl, dynamicVariables })`.
 */

/** Names the agent's tools and prompt expect (see `agent/tools.json`). */
export const AGENT_DYNAMIC_VARIABLES = ['party_code', 'player_name', 'session_token'] as const;

/** Used when the box (not a named player) opens the conversation: the agent then asks who is speaking. */
export const ROOM_PLAYER_NAME = 'the room';

/** `ELEVENLABS_AGENT_ID_<PERSONA>` (optional, one agent per voice) falls back to `ELEVENLABS_AGENT_ID`. */
export function agentIdFor(persona: Persona, env: Env): string | undefined {
  return env[`ELEVENLABS_AGENT_ID_${persona.toUpperCase()}`]?.trim() || env.ELEVENLABS_AGENT_ID?.trim() || undefined;
}

export async function createAgentSession(
  params: { partyCode: string; playerName?: string; sessionToken: string },
  deps: { env: Env; persona: Persona; fetch: FetchLike; log: Logger; timeoutMs?: number },
): Promise<AgentSession | null> {
  const apiKey = deps.env.ELEVENLABS_API_KEY?.trim();
  const agentId = agentIdFor(deps.persona, deps.env);
  if (!apiKey || !agentId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 4000);
  try {
    const base = (deps.env.ELEVENLABS_BASE_URL?.trim() || ELEVENLABS_BASE_URL).replace(/\/+$/, '');
    const res = await deps.fetch(`${base}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      deps.log.warn(`[announcer] voice agent unavailable: ${redact(await describeError(res), [apiKey])}; TALK uses the offline fallback`);
      return null;
    }
    const body = (await res.json()) as { signed_url?: unknown };
    if (typeof body.signed_url !== 'string' || !body.signed_url) {
      deps.log.warn('[announcer] voice agent unavailable: no signed_url in the response; TALK uses the offline fallback');
      return null;
    }
    return {
      agentId,
      signedUrl: body.signed_url,
      dynamicVariables: {
        party_code: params.partyCode,
        player_name: params.playerName?.trim() || ROOM_PLAYER_NAME,
        session_token: params.sessionToken,
      },
    };
  } catch (err) {
    const msg = controller.signal.aborted ? 'request timed out' : err instanceof Error ? err.message : 'network error';
    deps.log.warn(`[announcer] voice agent unavailable: ${redact(msg, [apiKey])}; TALK uses the offline fallback`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
