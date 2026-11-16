import { describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_VERSION, DEFAULT_LLM_MODEL, createLlmClient, extractFirstJson, latencyParams } from './llm';
import type { FetchLike } from './log';
import { jsonResponse, recordingLogger } from './test/fixtures';

const KEY = 'sk-ant-test-0000-secret';

function reply(text: string, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra });
}

describe('createLlmClient', () => {
  it('is unavailable without a key and never calls the network', async () => {
    const fetch = vi.fn<FetchLike>();
    const llm = createLlmClient({}, { fetch });
    expect(llm.available).toBe(false);
    expect(await llm.completeJson({ system: 's', user: 'u' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is unavailable for an unsupported provider', () => {
    const log = recordingLogger();
    const llm = createLlmClient({ LLM_PROVIDER: 'openai', ANTHROPIC_API_KEY: KEY }, { log });
    expect(llm.available).toBe(false);
    expect(log.warns.join(' ')).not.toContain(KEY);
  });

  it('sends a Messages API request and parses the JSON reply', async () => {
    const fetch = vi.fn<FetchLike>(async () => reply('{"lines":["Penalty to Portugal!"]}'));
    const llm = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch });
    expect(llm.available).toBe(true);
    const out = await llm.completeJson({ system: 'be an announcer', user: 'EVENT: market_opened', maxTokens: 120 });
    expect(out).toEqual({ lines: ['Penalty to Portugal!'] });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.model).toBe(DEFAULT_LLM_MODEL);
    expect(body.max_tokens).toBe(120);
    expect(body.system).toBe('be an announcer');
    expect(body.messages).toEqual([{ role: 'user', content: 'EVENT: market_opened' }]);
    // Sampling parameters are rejected on this API version; thinking is off for speed.
    expect(body).not.toHaveProperty('temperature');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config).toEqual({ effort: 'low' });
  });

  it('honours LLM_MODEL and ANTHROPIC_BASE_URL', async () => {
    const fetch = vi.fn<FetchLike>(async () => reply('{"ok":true}'));
    const llm = createLlmClient({ ANTHROPIC_API_KEY: KEY, LLM_MODEL: 'claude-opus-5-5', ANTHROPIC_BASE_URL: 'http://localhost:9999/' }, { fetch });
    await llm.completeJson({ system: 's', user: 'u' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:9999/v1/messages');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body).not.toHaveProperty('thinking');
  });

  it('reads the first JSON object out of a chatty reply and skips thinking blocks', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Sure! ```json\n{"lines":["He buries it!"],"note":"a } brace in a string"}\n``` hope that helps {"other":1}' },
        ],
        stop_reason: 'end_turn',
      }),
    );
    const llm = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch });
    expect(await llm.completeJson({ system: 's', user: 'u' })).toEqual({ lines: ['He buries it!'], note: 'a } brace in a string' });
  });

  it('resolves null on invalid JSON', async () => {
    const fetch = vi.fn<FetchLike>(async () => reply('He buries it! No JSON here.'));
    const llm = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch });
    expect(await llm.completeJson({ system: 's', user: 'u' })).toBeNull();
    const broken = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch: async () => reply('{"lines": ["unterminated') });
    expect(await broken.completeJson({ system: 's', user: 'u' })).toBeNull();
  });

  it('resolves null on a refusal', async () => {
    const llm = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch: async () => reply('', { stop_reason: 'refusal', content: [] }) });
    expect(await llm.completeJson({ system: 's', user: 'u' })).toBeNull();
  });

  it('aborts at timeoutMs and resolves null', async () => {
    let aborted = false;
    const fetch: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const log = recordingLogger();
    const llm = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch, log });
    const started = Date.now();
    expect(await llm.completeJson({ system: 's', user: 'u', timeoutMs: 40 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    expect(aborted).toBe(true);
    // A timeout is routine (the template is used); it is not worth a warning.
    expect(log.warns).toEqual([]);
    expect(llm.available).toBe(true);
  });

  it('still resolves on time when fetch ignores the abort signal', async () => {
    const fetch: FetchLike = () => new Promise<Response>(() => {});
    const llm = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch });
    const started = Date.now();
    expect(await llm.completeJson({ system: 's', user: 'u', timeoutMs: 30 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('resolves null on 401, stops calling, and never logs the key', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401),
    );
    const log = recordingLogger();
    const llm = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch, log });
    expect(await llm.completeJson({ system: 's', user: 'u' })).toBeNull();
    expect(llm.available).toBe(false);
    expect(await llm.completeJson({ system: 's', user: 'u' })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log.warns).toHaveLength(1);
    expect(log.warns[0]).toContain('401');
    expect([...log.warns, ...log.infos].join(' ')).not.toContain(KEY);
  });

  it('resolves null on a server error or a network failure but stays available', async () => {
    const log = recordingLogger();
    const overloaded = createLlmClient({ ANTHROPIC_API_KEY: KEY }, { fetch: async () => jsonResponse({ type: 'error' }, 529), log });
    expect(await overloaded.completeJson({ system: 's', user: 'u' })).toBeNull();
    expect(overloaded.available).toBe(true);
    const offline = createLlmClient(
      { ANTHROPIC_API_KEY: KEY },
      {
        fetch: async () => {
          throw new TypeError(`fetch failed for key ${KEY}`);
        },
        log,
      },
    );
    await expect(offline.completeJson({ system: 's', user: 'u' })).resolves.toBeNull();
    expect(log.warns.join(' ')).not.toContain(KEY);
  });
});

describe('extractFirstJson', () => {
  it('handles plain, fenced, prefixed and nested JSON', () => {
    expect(extractFirstJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractFirstJson('```json\n{"a":{"b":[1,2]}}\n```')).toEqual({ a: { b: [1, 2] } });
    expect(extractFirstJson('note {not json} then {"a":"x"}')).toEqual({ a: 'x' });
    expect(extractFirstJson('nothing')).toBeNull();
    expect(extractFirstJson('')).toBeNull();
    expect(extractFirstJson('42')).toBeNull();
  });
});

describe('latencyParams', () => {
  it('turns thinking off where the model allows it and lowers effort elsewhere', () => {
    expect(latencyParams('claude-haiku-5-5')).toEqual({ thinking: { type: 'disabled' }, output_config: { effort: 'low' } });
    expect(latencyParams('claude-opus-5-5')).toEqual({ output_config: { effort: 'low' } });
    expect(latencyParams('claude-fable-5-2')).toEqual({ output_config: { effort: 'low' } });
    expect(latencyParams('claude-sonnet-5-5')).toEqual({ thinking: { type: 'between_tools' }, output_config: { effort: 'low' } });
    expect(latencyParams('claude-haiku-4-5')).toEqual({});
  });
});
