/**
 * The engine under test, run as a child process with tsx (Playwright's own TypeScript loader cannot
 * import the engine's JSON model tables). Real adapters: Replay sports feed, the real question
 * engine + pricing models, the real announcer (Web Speech mode, no keys), the offline Gemini sample,
 * points settlement through the mock vault. Time is compressed: the replay runs at E2E_SPEED and
 * every engine-controlled duration is divided by the same factor (EngineTiming.timeScale).
 *
 * Prints `E2E_ENGINE_READY <url>` once listening; SIGTERM / SIGINT close it.
 */
import { startEngine } from '@huddle/engine';
import { E2E_STREAM_SECRET } from './constants';

const speed = Number(process.env.E2E_SPEED ?? 10);
const port = Number(process.env.E2E_PORT ?? 0);

const handle = await startEngine({
  port,
  host: '127.0.0.1',
  dataDir: ':memory:',
  logger: false,
  // A clean env: nothing from a developer's .env leaks into the test (no keys, no network).
  env: {
    SETTLEMENT: 'points',
    SPORTS_PROVIDER: 'replay',
    GEMINI_MOCK: '1',
    HUDDLE_NO_LAN: '1',
    QUICKNODE_STREAM_SECRET: E2E_STREAM_SECRET,
    ANNOUNCER_LLM_LINES: '0',
  },
  timing: { timeScale: speed, geminiRefreshMs: 0, faucetCooldownMs: 1_000 },
});

console.log(`E2E_ENGINE_READY ${handle.url}`);

let closing = false;
const stop = (): void => {
  if (closing) return;
  closing = true;
  void handle.close().finally(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
