import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_SPEED } from './constants';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface EngineProcess {
  url: string;
  logs: string[];
  stop(): Promise<void>;
}

/** Start `engine-server.ts` on a random port and wait for its ready line. */
export async function startEngineProcess(speed = E2E_SPEED): Promise<EngineProcess> {
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'e2e/support/engine-server.ts')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', E2E_SPEED: String(speed), E2E_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  const url = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`engine did not start:\n${logs.join('\n')}`)), 60_000);
    const onLine = (buf: Buffer): void => {
      for (const line of buf.toString().split('\n')) {
        if (!line.trim()) continue;
        logs.push(line);
        const m = /^E2E_ENGINE_READY (\S+)/.exec(line);
        if (m) {
          clearTimeout(t);
          resolve(m[1]!);
        }
      }
    };
    child.stdout?.on('data', onLine);
    child.stderr?.on('data', onLine);
    child.once('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`engine exited with ${code}:\n${logs.join('\n')}`));
    });
  });
  return {
    url,
    logs,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const t = setTimeout(() => child.kill('SIGKILL'), 5_000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
}

export interface PartyRest {
  party: { code: string; status: string; config: { settlement: string; buyIn: number; defaultMode: string }; chain: { partyAddress: string } };
  players: { pubkey: string; name: string; deposited: number; balance: number; payout?: number; isHouse?: boolean }[];
}

export async function getParty(url: string, code: string): Promise<PartyRest> {
  const res = await fetch(`${url}/parties/${code}`);
  if (!res.ok) throw new Error(`GET /parties/${code}: ${res.status}`);
  return (await res.json()) as PartyRest;
}
