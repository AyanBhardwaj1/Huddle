import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pino from 'pino';
import { startEngine } from './server';

/** Process entrypoint: load `.env` from the repo root, start the engine, shut down cleanly. */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

// DATA_DIR in .env is relative to the repo root, wherever the engine was started from.
const dataDir = path.resolve(repoRoot, process.env.DATA_DIR ?? './data');

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['secretKey', '*.secretKey', 'hostToken', '*.hostToken'],
  ...(process.stdout.isTTY ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } } : {}),
});

try {
  const handle = await startEngine({ dataDir, logger });
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    handle
      .close()
      .catch((e: unknown) => logger.error({ err: (e as Error).message }, 'shutdown failed'))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
} catch (e) {
  logger.error({ err: (e as Error).message }, 'engine failed to start');
  process.exit(1);
}
