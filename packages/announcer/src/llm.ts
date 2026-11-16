import type { LlmClient } from '@huddle/shared';
import { consoleLogger, redact, resolveFetch, type Env, type FetchLike, type Logger } from './log';

/**
 * LLM client (PRD section 6). Anthropic Messages API over plain `fetch`.
 *
 * Request shape verified against the bundled Claude API reference (2026-11): `POST /v1/messages` with
 * headers `x-api-key`, `anthropic-version: 2026-10-21`, `content-type: application/json`. On that API
 * version sampling parameters (`temperature`, `top_p`, `top_k`) are rejected, so none are sent.
 */

/** Current fast Haiku-tier model. The announcer has a 1.5 s budget, so speed beats depth here. */
export const DEFAULT_LLM_MODEL = 'claude-haiku-5-5';
export const ANTHROPIC_VERSION = '2026-10-21';
export const DEFAULT_LLM_TIMEOUT_MS = 1500;
const DEFAULT_MAX_TOKENS = 400;

export interface LlmOptions {
  fetch?: FetchLike;
  log?: Logger;
}

/**
 * Thinking / effort parameters per model family. We want the shortest possible time to a small JSON
 * answer, so thinking is switched off wherever the API allows it and effort is set to `low` elsewhere.
 */
export function latencyParams(model: string): Record<string, unknown> {
  const m = model.toLowerCase();
  // Always-on thinking: `disabled` is a 400; effort is the only control.
  if (/fable|mythos|opus-5-5/.test(m)) return { output_config: { effort: 'low' } };
  // Sonnet 5.5: `disabled` is a 400; `between_tools` is its thinking-off mode.
  if (/sonnet-5-5/.test(m)) return { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } };
  // Haiku 5.5, Opus 5 / 4.6+, Sonnet 5 / 4.6: `disabled` is accepted at effort `high` or below.
  if (/haiku-5|opus-5|sonnet-5|opus-4-[678]|sonnet-4-6/.test(m)) {
    return { thinking: { type: 'disabled' }, output_config: { effort: 'low' } };
  }
  // Older models (Haiku 4.5 and earlier) do not think unless asked and reject `effort`.
  return {};
}

/** Parse the first JSON object (or array) found in a model reply. Returns null when there is none. */
export function extractFirstJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const direct: unknown = JSON.parse(trimmed);
    if (direct !== null && typeof direct === 'object') return direct;
  } catch {
    /* fall through to scanning */
  }
  for (let start = 0; start < trimmed.length; start++) {
    const open = trimmed[start];
    if (open !== '{' && open !== '[') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1)) as unknown;
          } catch {
            break; // not valid JSON from this start; try the next opening bracket
          }
        }
      }
    }
  }
  return null;
}

interface AnthropicMessage {
  content?: { type?: string; text?: string }[];
  stop_reason?: string;
}

class AnthropicLlmClient implements LlmClient {
  private disabled = false;
  private warned = false;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike,
    private readonly log: Logger,
  ) {}

  get available(): boolean {
    return !this.disabled;
  }

  async completeJson(req: { system: string; user: string; maxTokens?: number; timeoutMs?: number }): Promise<unknown | null> {
    if (this.disabled) return null;
    const timeoutMs = req.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
    });
    try {
      // Race the request against the timer so a fetch that ignores the abort signal still resolves on time.
      return await Promise.race([this.request(req, controller.signal), timedOut]);
    } catch (err) {
      if (!controller.signal.aborted) this.warnOnce(`request failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async request(
    req: { system: string; user: string; maxTokens?: number },
    signal: AbortSignal,
  ): Promise<unknown | null> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        ...latencyParams(this.model),
      }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        // A bad key will not fix itself: stop calling so every line goes straight to templates.
        this.disabled = true;
        this.warnOnce(`API key rejected (HTTP ${res.status}); announcer lines fall back to templates`, true);
      } else {
        this.warnOnce(`HTTP ${res.status} from the Messages API; falling back to templates`);
      }
      return null;
    }
    const body = (await res.json()) as AnthropicMessage;
    // Safety classifiers can decline with HTTP 200; there is nothing usable in `content` then.
    if (body.stop_reason === 'refusal') return null;
    const text = (body.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return extractFirstJson(text);
  }

  private warnOnce(msg: string, force = false): void {
    if (this.warned && !force) return;
    this.warned = true;
    this.log.warn(`[llm] ${redact(msg, [this.apiKey])}`);
  }
}

class UnavailableLlmClient implements LlmClient {
  readonly available = false;
  async completeJson(): Promise<unknown | null> {
    return null;
  }
}

/**
 * LLM client factory. `LLM_PROVIDER=anthropic` (default) with `ANTHROPIC_API_KEY` and optional
 * `LLM_MODEL`. With no key (or an unsupported provider) the client reports `available = false` and
 * every caller uses its templates.
 */
export function createLlmClient(env: Env = process.env, opts: LlmOptions = {}): LlmClient {
  const log = opts.log ?? consoleLogger;
  const provider = (env.LLM_PROVIDER ?? 'anthropic').trim().toLowerCase() || 'anthropic';
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (provider !== 'anthropic') {
    log.warn(`[llm] LLM_PROVIDER=${provider} is not supported (only "anthropic"); using templates`);
    return new UnavailableLlmClient();
  }
  if (!apiKey) return new UnavailableLlmClient();
  const model = env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;
  const baseUrl = (env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '');
  return new AnthropicLlmClient(apiKey, model, baseUrl, resolveFetch(opts.fetch), log);
}
