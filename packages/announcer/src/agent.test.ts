import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_DIR,
  AGENT_FIRST_MESSAGE,
  ENGINE_URL_PLACEHOLDER,
  SECRET_PLACEHOLDER,
  TOOL_NAMES,
  agentBody,
  agentPrompt,
  loadToolConfigs,
} from '../agent/config';
import { AGENT_DYNAMIC_VARIABLES, ROOM_PLAYER_NAME } from './agent';
import { safetyViolation } from './lines';
import { PERSONAS, PERSONA_IDS } from './personas';
import { SFX_NAMES, SFX_PROMPTS } from './sfx';

describe('agent server tools (engine webhook contract)', () => {
  const tools = loadToolConfigs({ engineUrl: 'https://huddle.example.com/', secret: 's3cr"et\\' });

  it('defines the four tools as POST webhooks with the shared secret header', () => {
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const t of tools) {
      expect(t.type).toBe('webhook');
      expect(t.api_schema.method).toBe('POST');
      expect(t.api_schema.url).toBe(`https://huddle.example.com/agent-tools/${t.name}`);
      expect(t.api_schema.request_headers).toEqual({ 'x-huddle-secret': 's3cr"et\\' });
      expect(t.response_timeout_secs).toBeGreaterThanOrEqual(5);
      expect(t.response_timeout_secs).toBeLessThanOrEqual(300);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it('binds session_token to the dynamic variable on every tool, never to the model', () => {
    for (const t of tools) {
      const body = t.api_schema.request_body_schema;
      expect(body.type).toBe('object');
      expect(body.properties.session_token).toEqual({ type: 'string', dynamic_variable: 'session_token' });
      expect(body.required).toContain('session_token');
      // ElevenLabs allows only one of description / dynamic_variable / constant_value per property.
      for (const [name, prop] of Object.entries(body.properties)) {
        const set = [prop.description, prop.dynamic_variable].filter((v) => v !== undefined);
        expect(set, `${t.name}.${name}`).toHaveLength(1);
      }
    }
  });

  it('gives each tool exactly the parameters the engine expects', () => {
    const params = (name: string) => Object.keys(tools.find((t) => t.name === name)!.api_schema.request_body_schema.properties);
    expect(params('get_party_state')).toEqual(['session_token']);
    expect(params('get_market')).toEqual(['session_token', 'market_id']);
    expect(params('explain_odds')).toEqual(['session_token', 'market_id']);
    expect(params('draft_bet')).toEqual(['session_token', 'player', 'market_id', 'outcome', 'amount']);
    const draft = tools.find((t) => t.name === 'draft_bet')!;
    expect(draft.api_schema.request_body_schema.properties.amount!.type).toBe('number');
    expect(draft.api_schema.request_body_schema.properties.amount!.description).toMatch(/USDC/);
    expect(draft.description).toMatch(/never places a bet and never moves money/);
    expect(draft.api_schema.request_body_schema.required).toEqual(['session_token', 'player', 'market_id', 'outcome', 'amount']);
  });

  it('keeps real values out of the committed file', () => {
    const raw = readFileSync(join(AGENT_DIR, 'tools.json'), 'utf8');
    expect(raw.split(ENGINE_URL_PLACEHOLDER).length - 1).toBe(4);
    expect(raw.split(SECRET_PLACEHOLDER).length - 1).toBeGreaterThanOrEqual(4);
    expect(raw).not.toMatch(/https?:\/\//);
  });
});

describe('agent prompt and body', () => {
  it('states the guardrails for every persona and matches the committed prompt files', () => {
    for (const persona of PERSONA_IDS) {
      const prompt = agentPrompt(persona);
      expect(prompt).toContain(PERSONAS[persona].style);
      expect(prompt).toContain('{{player_name}}');
      expect(prompt).toContain('{{party_code}}');
      // The session token is only ever sent to the engine by the tool call, never shown to the model.
      expect(prompt).not.toContain('session_token');
      expect(prompt).toMatch(/Never invent numbers/);
      expect(prompt).toMatch(/cannot place bets or move money/);
      expect(prompt).toMatch(/confirm it in the app/);
      expect(prompt).toMatch(/chase losses/);
      expect(prompt).toMatch(/Never imitate, quote or name a real commentator/);
      expect(prompt).toContain(ROOM_PLAYER_NAME);
      for (const name of TOOL_NAMES) expect(prompt).toContain(name);
      expect(readFileSync(join(AGENT_DIR, 'prompts', `${persona}.md`), 'utf8')).toBe(`${prompt}\n`);
    }
  });

  it('builds the create/update body with voice, tools, placeholders and signed-URL auth', () => {
    const body = agentBody('nfl', { ELEVENLABS_VOICE_NFL: 'voiceNfl' }, ['t1', 't2', 't3', 't4']) as {
      name: string;
      conversation_config: {
        agent: { first_message: string; language: string; prompt: Record<string, unknown>; dynamic_variables: { dynamic_variable_placeholders: Record<string, string> } };
        tts: Record<string, unknown>;
      };
      platform_settings: { auth: { enable_auth: boolean } };
    };
    expect(body.name).toBe('Huddle Announcer (NFL)');
    expect(body.conversation_config.agent.first_message).toBe(AGENT_FIRST_MESSAGE);
    expect(body.conversation_config.agent.language).toBe('en');
    expect(body.conversation_config.agent.prompt.prompt).toBe(agentPrompt('nfl'));
    expect(body.conversation_config.agent.prompt.tool_ids).toEqual(['t1', 't2', 't3', 't4']);
    expect(body.conversation_config.agent.prompt).not.toHaveProperty('llm');
    expect(Object.keys(body.conversation_config.agent.dynamic_variables.dynamic_variable_placeholders).sort()).toEqual([...AGENT_DYNAMIC_VARIABLES].sort());
    expect(body.conversation_config.tts).toEqual({ voice_id: 'voiceNfl' });
    expect(body.platform_settings.auth.enable_auth).toBe(true);
    const custom = agentBody('calm', { ELEVENLABS_AGENT_LLM: 'gemini-2.5-flash', ELEVENLABS_AGENT_TTS_MODEL: 'eleven_flash_v2_5' }, []) as typeof body;
    expect(custom.conversation_config.agent.prompt.llm).toBe('gemini-2.5-flash');
    expect(custom.conversation_config.tts).toEqual({ voice_id: PERSONAS.calm.defaultVoiceId, model_id: 'eleven_flash_v2_5' });
  });
});

describe('personas and stingers', () => {
  it('uses three distinct stock voices and safe style guides', () => {
    expect(new Set(PERSONA_IDS.map((p) => PERSONAS[p].defaultVoiceId)).size).toBe(3);
    for (const p of PERSONA_IDS) {
      expect(PERSONAS[p].defaultVoiceId).toMatch(/^[A-Za-z0-9]{20}$/);
      expect(safetyViolation(PERSONAS[p].style)).toBeNull();
      expect(PERSONAS[p].voiceSettings.speed).toBeGreaterThanOrEqual(0.7);
      expect(PERSONAS[p].voiceSettings.speed).toBeLessThanOrEqual(1.2);
    }
  });

  it('has a Sound Effects prompt within API limits for each stinger', () => {
    expect([...SFX_NAMES].sort()).toEqual(['cash_register', 'crowd_roar', 'goal_horn', 'lock_buzzer', 'sad_trombone']);
    for (const name of SFX_NAMES) {
      const p = SFX_PROMPTS[name];
      expect(p.text.length).toBeGreaterThan(10);
      expect(p.durationSeconds).toBeGreaterThanOrEqual(0.5);
      expect(p.durationSeconds).toBeLessThanOrEqual(30);
      expect(p.promptInfluence).toBeGreaterThanOrEqual(0);
      expect(p.promptInfluence).toBeLessThanOrEqual(1);
    }
  });
});
