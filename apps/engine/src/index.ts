import os from 'node:os';
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

// Hosted on Render: its public URL (set automatically by Render) is the address phones should use.
if (!(process.env.PUBLIC_ENGINE_URL ?? '').trim() && (process.env.RENDER_EXTERNAL_URL ?? '').trim()) {
  process.env.PUBLIC_ENGINE_URL = process.env.RENDER_EXTERNAL_URL;
}

// Without a tunnel URL, advertise the LAN address so phones on the same Wi-Fi can scan the QR code.
if (!(process.env.PUBLIC_ENGINE_URL ?? '').trim() && process.env.HUDDLE_NO_LAN !== '1') {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);
  if (lan) process.env.PUBLIC_ENGINE_URL = `http://${lan.address}:${process.env.PORT ?? 8080}`;
}

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
