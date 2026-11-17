/**
 * `pnpm demo`: one command that shows the whole product (PRD section 17, step 5).
 *
 *   1. builds the box UI and the player app if their dist/ is missing or older than the source;
 *   2. starts the mock box bridge (child process) and the party engine (in this process);
 *   3. creates a party on a replay game and adds N bot players;
 *   4. opens the box screen (already inside the party) and a player join link in the browser;
 *   5. Ctrl-C stops everything.
 *
 * Works with no .env and no network (Replay mode, mocks, points settlement).
 *
 *   pnpm demo [--game replay-por-esp|replay-ten-dal] [--mode pool|market|bet] [--players 3]
 *             [--speed 1] [--settlement points|trusted|vault] [--buy-in 10] [--autostart]
 *             [--no-open] [--no-bridge] [--no-build] [--keep-data]
 *   PORT=8080 BRIDGE_PORT=7777 DATA_DIR=<dir> also apply.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runBots, startEngine, type BotsHandle, type EngineHandle, type EngineOptions } from '@huddle/engine';

type EngineLogger = Exclude<EngineOptions['logger'], false | undefined>;
import { ROOT, buildStaleUis, needsBuild } from './lib/build';

// ───────────────────────── args ─────────────────────────

interface DemoArgs {
  game: string;
  mode: 'pool' | 'amm' | 'bet';
  players: number;
  speed: number;
  settlement: 'points' | 'trusted' | 'vault' | undefined;
  buyIn: number;
  autostart: boolean;
  open: boolean;
  bridge: boolean;
  build: boolean;
  keepData: boolean;
}

const USAGE = `usage: pnpm demo [options]
  --game ID          replay to watch (default replay-por-esp; also replay-ten-dal)
  --mode MODE        pool | market | bet (default pool)
  --players N        bot players to add, 0 to 12 (default 3)
  --speed X          replay speed, 0.25 to 20 (default 1); engine timers scale with it
  --settlement S     points | trusted | vault (default: SETTLEMENT from .env, else points)
  --buy-in N         buy-in per player (default 10)
  --autostart        start the replay right away instead of waiting for "Start game" on the box
  --no-open          do not open the browser
  --no-bridge        do not start the mock box bridge
  --no-build         never rebuild the UIs
  --keep-data        keep the temporary data directory on exit
env: PORT (engine, default 8080), BRIDGE_PORT (mock bridge, default 7777), DATA_DIR (default: a fresh temp dir)`;

export function parseDemoArgs(argv: string[]): DemoArgs {
  const a: DemoArgs = {
    game: 'replay-por-esp',
    mode: 'pool',
    players: 3,
    speed: 1,
    settlement: undefined,
    buyIn: 10,
    autostart: false,
    open: true,
    bridge: true,
    build: true,
    keepData: false,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (raw === '--') continue;
    const [flag, inline] = raw.split('=', 2) as [string, string | undefined];
    const take = (): string => {
      if (inline !== undefined) return inline;
      const v = value(i, flag);
      i++;
      return v;
    };
    switch (flag) {
      case '--game':
        a.game = take();
        break;
      case '--mode': {
        const m = take().toLowerCase();
        if (m === 'market' || m === 'amm') a.mode = 'amm';
        else if (m === 'pool' || m === 'bet') a.mode = m;
        else throw new Error('--mode must be pool, market or bet');
        break;
      }
      case '--players':
      case '--bots': {
        const n = Number(take());
        if (!Number.isInteger(n) || n < 0 || n > 12) throw new Error('--players must be 0 to 12');
        a.players = n;
        break;
      }
      case '--speed': {
        const s = Number(take());
        if (!(s >= 0.25 && s <= 20)) throw new Error('--speed must be between 0.25 and 20');
        a.speed = s;
        break;
      }
      case '--settlement': {
        const s = take();
        if (s !== 'points' && s !== 'trusted' && s !== 'vault') throw new Error('--settlement must be points, trusted or vault');
        a.settlement = s;
        break;
      }
      case '--buy-in': {
        const b = Number(take());
        if (!(b > 0 && b <= 1000)) throw new Error('--buy-in must be between 0 and 1000');
        a.buyIn = b;
        break;
      }
      case '--autostart':
        a.autostart = true;
        break;
      case '--no-open':
        a.open = false;
        break;
      case '--no-bridge':
        a.bridge = false;
        break;
      case '--no-build':
        a.build = false;
        break;
      case '--keep-data':
        a.keepData = true;
        break;
      case '--help':
      case '-h':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option ${raw}`);
    }
  }
  return a;
}

// ───────────────────────── helpers ─────────────────────────

const c = {
  bold: (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s),
  dim: (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s),
  volt: (s: string) => (process.stdout.isTTY ? `\x1b[38;5;191m${s}\x1b[39m` : s),
  red: (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[39m` : s),
};
const say = (tag: string, line: string): void => console.log(`${c.dim(`[${tag}]`)} ${line}`);

/** Load KEY=VALUE lines from the repo's .env without overriding what is already set. */
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = v;
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '0.0.0.0' }, () => srv.close(() => resolve(true)));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect({ port, host: '127.0.0.1' });
      s.once('connect', () => (s.destroy(), resolve(true)));
      s.once('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nothing is listening on port ${port} after ${timeoutMs} ms`);
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => say('demo', `could not open a browser; open ${url} yourself`));
    p.unref();
  } catch {
    say('demo', `could not open a browser; open ${url} yourself`);
  }
}

/** The LAN address phones on the same Wi-Fi can reach (same rule as apps/engine/src/index.ts). */
function lanAddress(): string | null {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);
  return lan ? lan.address : null;
}

/** pino-compatible destination that prints one short line per engine log record. */
function engineLogStream(): Writable {
  const LEVELS: Record<number, string> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' };
  return new Writable({
    write(chunk: Buffer, _enc, done) {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as Record<string, unknown>;
          const { level, msg, time: _t, pid: _p, hostname: _h, ...rest } = rec;
          const extra = Object.keys(rest).length ? ` ${c.dim(JSON.stringify(rest))}` : '';
          const lv = LEVELS[level as number] ?? String(level);
          say('engine', `${lv === 'info' ? '' : `${lv} `}${String(msg)}${extra}`);
        } catch {
          say('engine', line);
        }
      }
      done();
    },
  });
}

// ───────────────────────── main ─────────────────────────

async function main(): Promise<void> {
  let args: DemoArgs;
  try {
    args = parseDemoArgs(process.argv.slice(2));
  } catch (e) {
    console.error(c.red((e as Error).message));
    console.error(USAGE);
    process.exit(2);
  }

  loadDotEnv(path.join(ROOT, '.env'));
  const port = Number(process.env.PORT ?? 8080);
  const bridgePort = Number(process.env.BRIDGE_PORT ?? 7777);

  const children: ChildProcess[] = [];
  let engine: EngineHandle | null = null;
  let bots: BotsHandle | null = null;
  let dataDir = '';
  let tempData = false;
  let stopping = false;

  const shutdown = async (code: number): Promise<never> => {
    if (stopping) process.exit(code);
    stopping = true;
    console.log('');
    say('demo', 'shutting down…');
    try {
      bots?.close();
    } catch {}
    try {
      await engine?.close();
    } catch (e) {
      say('demo', `engine close failed: ${(e as Error).message}`);
    }
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) return resolve();
            const t = setTimeout(() => {
              child.kill('SIGKILL');
              resolve();
            }, 3000);
            child.once('exit', () => {
              clearTimeout(t);
              resolve();
            });
            child.kill('SIGTERM');
          }),
      ),
    );
    if (tempData && !args.keepData) fs.rmSync(dataDir, { recursive: true, force: true });
    else if (dataDir) say('demo', `data kept in ${dataDir}`);
    say('demo', 'bye');
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  try {
    // 1. Ports.
    if (!(await portFree(port))) throw new Error(`port ${port} is busy (another engine?). Set PORT=… to use another one.`);
    if (args.bridge && !(await portFree(bridgePort))) {
      throw new Error(`port ${bridgePort} is busy (another bridge?). Set BRIDGE_PORT=… or pass --no-bridge.`);
    }

    // 2. UIs.
    if (args.build) buildStaleUis(ROOT, (l) => say('demo', l));
    const stale = (['box', 'player'] as const).filter((app) => needsBuild(app));
    if (stale.length) {
      say('demo', `warning: ${stale.join(' + ')} UI is missing or stale and --no-build was given`);
    }

    // 3. Mock bridge (child process: it owns a WebSocket server and a terminal LED preview).
    if (args.bridge) {
      // '--import tsx' resolves from cwd (the repo root, where tsx is a devDependency).
      const bridge = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'apps/box-bridge/src/index.ts'), '--mock'], {
        cwd: ROOT,
        env: { ...process.env, BRIDGE_PORT: String(bridgePort) },
        // stdin is not a TTY on purpose: Ctrl-C must reach this process, not the bridge's raw keyboard.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(bridge);
      const prefix = (buf: Buffer): void => {
        for (const line of buf.toString().split('\n')) if (line.trim()) say('bridge', line);
      };
      bridge.stdout?.on('data', prefix);
      bridge.stderr?.on('data', prefix);
      bridge.on('exit', (code, sig) => {
        if (!stopping) say('bridge', `exited (${sig ?? code}); the box keeps working with its on-screen buttons`);
      });
      await waitForPort(bridgePort, 15_000);
      process.env.BRIDGE_URL = `ws://localhost:${bridgePort}`;
    } else {
      delete process.env.BRIDGE_URL;
    }

    // 4. Engine, in process so the replay speed and the engine's timers scale together.
    if (process.env.DATA_DIR) dataDir = path.resolve(ROOT, process.env.DATA_DIR);
    else {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-demo-'));
      tempData = true;
    }
    if (!(process.env.PUBLIC_ENGINE_URL ?? '').trim() && process.env.HUDDLE_NO_LAN !== '1') {
      const lan = lanAddress();
      if (lan) process.env.PUBLIC_ENGINE_URL = `http://${lan}:${port}`;
    }
    // pino is the engine's dependency, not the root's: load it from there.
    const pino = createRequire(path.join(ROOT, 'apps/engine/package.json'))('pino') as (opts: object, dest: Writable) => EngineLogger;
    const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', redact: ['secretKey', '*.secretKey', 'hostToken', '*.hostToken'] }, engineLogStream());
    engine = await startEngine({
      port,
      dataDir,
      logger,
      timing: { timeScale: args.speed },
    });
    const local = `http://localhost:${port}`;

    // 5. Party.
    const res = await fetch(`${local}/parties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Huddle demo party',
        gameId: args.game,
        defaultMode: args.mode,
        buyIn: args.buyIn,
        ...(args.settlement ? { settlement: args.settlement } : {}),
      }),
    });
    const body = (await res.json()) as { party?: { code: string; joinUrl: string; game: { title: string }; config: { settlement: string } }; hostToken?: string; error?: { message: string } };
    if (!res.ok || !body.party || !body.hostToken) {
      const games = (await (await fetch(`${local}/games`)).json()) as { games: { id: string }[] };
      throw new Error(`could not create the party: ${body.error?.message ?? res.status}. Games: ${games.games.map((g) => g.id).join(', ')}`);
    }
    const { party, hostToken } = body;
    const host = { 'content-type': 'application/json', 'x-host-token': hostToken };
    if (args.speed !== 1) {
      await fetch(`${local}/replays/${args.game}/start`, { method: 'POST', headers: host, body: JSON.stringify({ partyCode: party.code, action: 'speed', speed: args.speed }) });
    }

    // 6. Bots.
    if (args.players > 0) {
      bots = await runBots({
        url: local,
        partyCode: party.code,
        n: args.players,
        intervalMs: Math.max(300, Math.round(2500 / args.speed)),
        log: (line) => say('bots', line),
      });
      say('bots', `${args.players} bot players joined and bought in`);
    }

    // 7. Browser + banner.
    const boxUrl = `${local}/box/#party=${encodeURIComponent(party.code)}&host=${encodeURIComponent(hostToken)}`;
    const playerUrl = `${local}/j/${party.code}`;
    const modeLabel = { pool: 'Pool', amm: 'Market', bet: 'Bet (head-to-head)' }[args.mode];
    const line = '─'.repeat(64);
    console.log(`\n${c.volt(line)}`);
    console.log(`  ${c.bold(c.volt('HUDDLE DEMO'))}   ${party.game.title}`);
    console.log(`  Party code   ${c.bold(party.code)}   ·   ${modeLabel} mode   ·   settlement: ${party.config.settlement}${args.speed !== 1 ? `   ·   ${args.speed}x` : ''}`);
    console.log(`  Box screen   ${c.bold(`${local}/box/`)}  ${c.dim('(opened already inside the party)')}`);
    console.log(`  Join link    ${c.bold(playerUrl)}`);
    if (party.joinUrl !== playerUrl) console.log(`  Phones       ${c.bold(party.joinUrl)}  ${c.dim('(same Wi-Fi; the QR on the box)')}`);
    console.log(`  Bridge       ${args.bridge ? `ws://localhost:${bridgePort} (mock; LED preview below)` : 'off'}`);
    console.log('');
    console.log(`  1. On the player tab: type a name, tap ${c.bold('Buy in')}.`);
    console.log(`  2. On the box: tap ${c.bold('Tap to enable sound')}, then ${c.bold('Start game')}${args.autostart ? ' (already started)' : ''}.`);
    console.log(`  3. Bet on the questions as they appear. Box keys: ${c.bold('L')} lock, hold ${c.bold('T')} talk, ${c.bold('N')} next screen.`);
    console.log(`  Ctrl-C stops everything.`);
    console.log(`${c.volt(line)}\n`);

    if (args.autostart) {
      const r = await fetch(`${local}/replays/${args.game}/start`, { method: 'POST', headers: host, body: JSON.stringify({ partyCode: party.code, action: 'start' }) });
      say('demo', r.ok ? 'replay started' : `could not start the replay (${r.status})`);
    }
    if (args.open) {
      openBrowser(boxUrl);
      setTimeout(() => openBrowser(playerUrl), 800);
    }
  } catch (e) {
    console.error(c.red(`demo failed: ${(e as Error).message}`));
    await shutdown(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main();
