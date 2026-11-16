/**
 * Create or update the Huddle talk-back agent on ElevenLabs Agents (PRD section 7).
 *
 *   pnpm --filter @huddle/announcer setup-agent                      # soccer persona
 *   pnpm --filter @huddle/announcer setup-agent -- --persona nfl
 *   pnpm --filter @huddle/announcer setup-agent -- --dry-run         # print what would be sent
 *   pnpm --filter @huddle/announcer setup-agent -- --write-prompts   # refresh agent/prompts/*.md
 *
 * Needs ELEVENLABS_API_KEY, PUBLIC_ENGINE_URL (the public tunnel URL of the engine) and
 * AGENT_TOOLS_SECRET. With `ELEVENLABS_AGENT_ID` (or `ELEVENLABS_AGENT_ID_<PERSONA>`) set, that agent
 * is updated; otherwise a new one is created and its id is printed for `.env`.
 *
 * Endpoints (verified against the official API reference on 2026-11-16):
 *   GET   /v1/convai/tools?search=&page_size=      -> { tools: [{ id, tool_config }], has_more, next_cursor }
 *   POST  /v1/convai/tools            { tool_config }  -> { id, ... }
 *   PATCH /v1/convai/tools/{tool_id}  { tool_config }
 *   POST  /v1/convai/agents/create    { name, conversation_config, platform_settings } -> { agent_id }
 *   PATCH /v1/convai/agents/{agent_id}
 * Without a key (or with --dry-run) nothing is sent: the script prints the payloads and the dashboard
 * steps from agent/AGENT_SETUP.md instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Persona } from '@huddle/shared';
import { AGENT_DIR, TOOL_NAMES, agentBody, agentName, agentPrompt, loadToolConfigs, type WebhookToolConfig } from '../agent/config';
import { agentIdFor } from '../src/agent';
import { redact } from '../src/log';
import { PERSONAS, PERSONA_IDS, isPersona, voiceIdFor } from '../src/personas';
import { ELEVENLABS_BASE_URL, describeError } from '../src/tts';
import { flag, loadEnv, option } from './env';

const SECRET_MASK = '<AGENT_TOOLS_SECRET>';

function writePrompts(): void {
  const dir = join(AGENT_DIR, 'prompts');
  mkdirSync(dir, { recursive: true });
  for (const p of PERSONA_IDS) {
    writeFileSync(join(dir, `${p}.md`), `${agentPrompt(p)}\n`);
    console.log(`wrote agent/prompts/${p}.md`);
  }
}

function maskSecret(tools: WebhookToolConfig[]): WebhookToolConfig[] {
  return tools.map((t) => ({
    ...t,
    api_schema: { ...t.api_schema, request_headers: Object.fromEntries(Object.keys(t.api_schema.request_headers).map((k) => [k, SECRET_MASK])) },
  }));
}

function printManualSteps(persona: Persona, engineUrl: string, voiceId: string): void {
  console.log(`
Dashboard steps (about 5 minutes). Full guide: packages/announcer/agent/AGENT_SETUP.md

1. elevenlabs.io -> Agents -> "New agent" -> blank template. Name: "${agentName(persona)}".
2. Agent tab:
   - First message: leave empty (the player speaks first).
   - System prompt: paste packages/announcer/agent/prompts/${persona}.md
   - Language: English.
3. Voice tab: pick voice id ${voiceId} (${PERSONAS[persona].defaultVoiceName} by default, a stock library voice).
4. Tools -> "Add tool" -> Webhook, four times (${TOOL_NAMES.join(', ')}):
   - Method POST, URL ${engineUrl}/agent-tools/<tool_name>
   - Header x-huddle-secret = your AGENT_TOOLS_SECRET (store it as a secret)
   - Body parameters exactly as in packages/announcer/agent/tools.json;
     set "session_token" to value type "Dynamic variable" -> session_token.
5. Security tab: turn on "Enable authentication" (the engine hands out signed URLs).
6. Copy the agent id into .env as ELEVENLABS_AGENT_ID and restart the engine.`);
}

async function api<T>(base: string, apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'xi-api-key': apiKey, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} failed: ${await describeError(res)}`);
  return (await res.json()) as T;
}

interface ToolListItem {
  id: string;
  tool_config?: { name?: string; type?: string };
}

async function findTool(base: string, apiKey: string, name: string): Promise<string | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ search: name, page_size: '100' });
    if (cursor) qs.set('cursor', cursor);
    const res = await api<{ tools?: ToolListItem[]; has_more?: boolean; next_cursor?: string | null }>(base, apiKey, 'GET', `/v1/convai/tools?${qs.toString()}`);
    const hit = (res.tools ?? []).find((t) => t.tool_config?.name === name && (t.tool_config.type ?? 'webhook') === 'webhook');
    if (hit) return hit.id;
    if (!res.has_more || !res.next_cursor) return undefined;
    cursor = res.next_cursor;
  }
  return undefined;
}

async function main(): Promise<void> {
  if (flag('write-prompts')) {
    writePrompts();
    return;
  }
  const env = loadEnv();
  const personaArg = option('persona') ?? 'soccer';
  if (!isPersona(personaArg)) {
    console.error(`Unknown persona "${personaArg}". Use one of: ${PERSONA_IDS.join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  const persona: Persona = personaArg;
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const secret = env.AGENT_TOOLS_SECRET?.trim();
  const engineUrl = (env.PUBLIC_ENGINE_URL?.trim() || '').replace(/\/+$/, '');
  const base = (env.ELEVENLABS_BASE_URL?.trim() || ELEVENLABS_BASE_URL).replace(/\/+$/, '');
  const voiceId = voiceIdFor(persona, env);
  const dryRun = flag('dry-run');
  const say = (msg: string): void => console.log(redact(msg, [apiKey, secret]));

  const shownUrl = engineUrl || 'https://<your-engine-tunnel>';
  const tools = loadToolConfigs({ engineUrl: shownUrl, secret: secret ?? SECRET_MASK });

  const missing = [!apiKey && 'ELEVENLABS_API_KEY', !engineUrl && 'PUBLIC_ENGINE_URL', !secret && 'AGENT_TOOLS_SECRET'].filter(Boolean);
  if (dryRun || missing.length) {
    if (missing.length) console.log(`Not calling the ElevenLabs API: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`);
    console.log('\nTool definitions (POST /v1/convai/tools, one request each, body { "tool_config": ... }):');
    console.log(JSON.stringify(maskSecret(tools), null, 2));
    console.log('\nAgent definition (POST /v1/convai/agents/create), with tool_ids filled in from the calls above:');
    console.log(JSON.stringify(agentBody(persona, env, TOOL_NAMES.map((n) => `<id of ${n}>`)), null, 2));
    printManualSteps(persona, shownUrl, voiceId);
    return;
  }
  if (!apiKey || !secret) return; // unreachable: narrowed for the type checker

  if (/^https?:\/\/(localhost|127\.|\[::1\]|192\.168\.|10\.)/i.test(engineUrl)) {
    console.warn(`PUBLIC_ENGINE_URL is ${engineUrl}: ElevenLabs cannot reach a local address. Use the tunnel URL.`);
  }

  try {
    const toolIds: string[] = [];
    for (const tool of tools) {
      const existing = await findTool(base, apiKey, tool.name);
      if (existing) {
        await api(base, apiKey, 'PATCH', `/v1/convai/tools/${encodeURIComponent(existing)}`, { tool_config: tool });
        say(`updated tool ${tool.name} (${existing})`);
        toolIds.push(existing);
      } else {
        const created = await api<{ id: string }>(base, apiKey, 'POST', '/v1/convai/tools', { tool_config: tool });
        say(`created tool ${tool.name} (${created.id})`);
        toolIds.push(created.id);
      }
    }

    const body = agentBody(persona, env, toolIds);
    const existingAgent = flag('new') ? undefined : agentIdFor(persona, env);
    if (existingAgent) {
      await api(base, apiKey, 'PATCH', `/v1/convai/agents/${encodeURIComponent(existingAgent)}`, body);
      say(`updated agent ${agentName(persona)} (${existingAgent})`);
    } else {
      const created = await api<{ agent_id: string }>(base, apiKey, 'POST', '/v1/convai/agents/create', body);
      say(`created agent ${agentName(persona)}`);
      say(`\nAdd this to .env and restart the engine:\n  ELEVENLABS_AGENT_ID=${created.agent_id}`);
    }
    say(`\nVoice: ${voiceId}. Tools call ${engineUrl}/agent-tools/<tool> with header x-huddle-secret.`);
    say('Test it: open the agent in the ElevenLabs dashboard, or press TALK on the box and ask "what are the odds?".');
  } catch (err) {
    console.error(redact(err instanceof Error ? err.message : 'unknown error', [apiKey, secret]));
    console.error('\nThe API call failed. You can finish the setup by hand instead:');
    printManualSteps(persona, engineUrl, voiceId);
    process.exitCode = 1;
  }
}

void main();
