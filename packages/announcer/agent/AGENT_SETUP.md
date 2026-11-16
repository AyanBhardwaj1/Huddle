# Huddle talk-back agent: setup guide (ElevenLabs Agents)

The TALK button (box) and the mic button (app) open a conversation with an ElevenLabs Agent that speaks in
the announcer's voice and can call four tools on the Huddle engine. This guide sets that agent up. It
takes about five minutes.

Without an agent, TALK still works: the browser transcribes the question and the engine answers it with
the rule-based parser in `packages/announcer/src/talk.ts` (DECISIONS D12).

## What you need

| Variable | What it is |
| --- | --- |
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key (needs access to Agents and Text to Speech) |
| `PUBLIC_ENGINE_URL` | Public HTTPS URL of the engine (the tunnel URL). ElevenLabs calls the tools from its servers, so `localhost` does not work |
| `AGENT_TOOLS_SECRET` | Any long random string. The engine rejects tool calls without it |

Put them in the repo-root `.env`. Never commit that file.

## Option A: the script (recommended)

```bash
pnpm --filter @huddle/announcer setup-agent                    # soccer persona
pnpm --filter @huddle/announcer setup-agent -- --persona nfl   # or nfl / calm
pnpm --filter @huddle/announcer setup-agent -- --dry-run       # print the payloads, send nothing
```

The script creates (or updates) the four tools, then creates the agent and prints:

```text
ELEVENLABS_AGENT_ID=agent_...
```

Add that line to `.env` and restart the engine. Run the script again any time the tunnel URL, the secret,
the prompt or the voice changes: with `ELEVENLABS_AGENT_ID` set it updates the same agent in place.

One agent has one voice. If you want TALK to follow the host's persona choice, create one agent per
persona and set `ELEVENLABS_AGENT_ID_SOCCER`, `ELEVENLABS_AGENT_ID_NFL` and `ELEVENLABS_AGENT_ID_CALM`
(each falls back to `ELEVENLABS_AGENT_ID`).

If the script reports an API error, it prints the dashboard steps below with your values filled in.

## Option B: by hand in the dashboard (5 minutes)

Menu labels in the dashboard change from time to time; the settings themselves are what matter.

1. **Create the agent.** elevenlabs.io, Agents, new agent, blank template. Name it `Huddle Announcer (Soccer)`.
2. **Prompt.** Paste the contents of `agent/prompts/soccer.md` (or `nfl.md` / `calm.md`) as the system prompt.
   Leave the first message empty: the player presses TALK and speaks first. Language: English.
3. **Voice.** Pick a stock voice from the voice library. Defaults: Soccer `JBFqnCBsd6RMkjVDRZzb` (George),
   NFL `nPczCjzI2devNBz1zQrb` (Brian), Calm `cjVigY5qzO86Huf0OWal` (Eric). Never use a cloned voice or a
   voice that imitates a real commentator or celebrity.
4. **Tools.** Add four tools of type **Webhook** (server tool). For each one:
   - Name and description: copy from `agent/tools.json`.
   - Method `POST`, URL `<PUBLIC_ENGINE_URL>/agent-tools/<tool_name>`.
   - Header `x-huddle-secret` with your `AGENT_TOOLS_SECRET` (store it as a secret, not plain text, if the
     dashboard offers that).
   - Body parameters:

     | Tool | Parameters |
     | --- | --- |
     | `get_party_state` | `session_token` |
     | `get_market` | `session_token`, `market_id` |
     | `explain_odds` | `session_token`, `market_id` |
     | `draft_bet` | `session_token`, `player`, `market_id`, `outcome`, `amount` (number, in USDC) |

   - For `session_token`, set the value type to **Dynamic variable** and choose `session_token`. Every other
     parameter is filled in by the model: copy its description from `agent/tools.json`.
5. **Dynamic variables.** The agent uses `party_code`, `player_name` and `session_token`. Give them test
   values (for example `DEMO`, `the room`, `test`) so the dashboard's test call works.
6. **Security.** Turn on authentication (signed URLs). The engine requests a signed URL for every
   conversation, so the agent is not open to anyone who learns its id.
7. Copy the agent id into `.env` as `ELEVENLABS_AGENT_ID` and restart the engine.

## How a conversation starts

1. The client calls the engine: `GET /agent/session`.
2. The engine calls `announcer.agentSession({ partyCode, playerName, sessionToken })`, which asks ElevenLabs
   for a signed URL (`GET /v1/convai/conversation/get-signed-url?agent_id=...`, valid for 15 minutes) and
   returns:

   ```json
   {
     "agentId": "agent_...",
     "signedUrl": "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=...&conversation_signature=...",
     "dynamicVariables": { "party_code": "ABCD", "player_name": "Jake", "session_token": "<signed token>" }
   }
   ```

3. The client starts the session with the ElevenLabs client SDK (`@elevenlabs/client`):

   ```ts
   import { Conversation } from '@elevenlabs/client';

   const conversation = await Conversation.startSession({
     signedUrl: session.signedUrl,
     dynamicVariables: session.dynamicVariables,
   });
   // on TALK release: await conversation.endSession();
   ```

   When `GET /agent/session` returns `null` (no agent configured, or ElevenLabs is unreachable), the client
   falls back to Web Speech recognition and sends `talk_text`.

`player_name` is `the room` when the box, not a named player, opens the conversation. The prompt tells the
agent to ask who is speaking before it drafts a bet in that case.

## What the tools send to the engine

Every call is `POST <PUBLIC_ENGINE_URL>/agent-tools/<tool>` with header `x-huddle-secret: <AGENT_TOOLS_SECRET>`
and a JSON body. `session_token` is the dynamic variable from the conversation start; the model never sees
it and cannot change it.

```jsonc
// get_party_state
{ "session_token": "..." }
// get_market, explain_odds
{ "session_token": "...", "market_id": "m_123" }
// draft_bet  (amount is USDC as a plain number, not base units)
{ "session_token": "...", "player": "Jake", "market_id": "m_123", "outcome": "yes", "amount": 5 }
```

`draft_bet` only creates a draft. The player confirms it with one tap in the app; the agent can never move
money. The engine should answer with small JSON objects: the agent reads the whole response, so short and
flat is faster and cheaper.

## Check that it works

1. In the dashboard, open the agent's test call and ask "what's open?". The call log should show
   `get_party_state` returning 200. A 401 means the secret header does not match; a timeout means
   ElevenLabs cannot reach `PUBLIC_ENGINE_URL`.
2. Start a party, press TALK on the box and ask "what are the odds on the penalty?". The answer must
   match the number on the screen.
3. Say "put five on yes". A draft appears in the app and nothing is staked until you tap confirm.
4. Ask something off-topic. The agent should decline in one sentence.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| TALK uses the robotic browser voice | `GET /agent/session` returned `null`: check `ELEVENLABS_AGENT_ID`, the API key and the engine log line starting `[announcer] voice agent unavailable` |
| Conversation fails to start with a missing variable error | The client did not pass all three dynamic variables |
| Tools return 401 | `AGENT_TOOLS_SECRET` in `.env` differs from the header stored on the tools: run the script again |
| Tools time out | The tunnel URL changed: update `PUBLIC_ENGINE_URL` and run the script again |
| The agent quotes a wrong number | It answered without calling a tool. Check the transcript in the dashboard and report it; the prompt forbids this |

## API reference used (checked 2026-11-16 against the official docs)

- `GET /v1/convai/conversation/get-signed-url?agent_id=` returns `{ "signed_url": "..." }`.
- `POST /v1/convai/tools` with `{ "tool_config": { "type": "webhook", "name", "description", "response_timeout_secs", "api_schema": { "url", "method", "request_headers", "request_body_schema" } } }` returns `{ "id": "..." }`.
  A body property carries exactly one of `description` (the model fills it), `dynamic_variable` or `constant_value`.
- `PATCH /v1/convai/tools/{tool_id}`, `GET /v1/convai/tools?search=`.
- `POST /v1/convai/agents/create` with `{ "name", "conversation_config": { "agent": { "first_message", "language", "prompt": { "prompt", "tool_ids" }, "dynamic_variables": { "dynamic_variable_placeholders" } }, "tts": { "voice_id" } }, "platform_settings": { "auth": { "enable_auth": true } } }` returns `{ "agent_id": "..." }`.
- `PATCH /v1/convai/agents/{agent_id}` takes the same body.
- All requests authenticate with the `xi-api-key` header.
