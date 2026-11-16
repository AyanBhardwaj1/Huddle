import { runBots } from './bots';

/**
 * Bot players for a running engine:
 *   pnpm --filter @huddle/engine bots -- --party CODE --n 5 [--url http://localhost:8080] [--interval 1500] [--buy-in 10]
 */

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--') || a === '--') continue;
    const [key, inline] = a.slice(2).split('=');
    const next = argv[i + 1];
    if (inline !== undefined) out[key!] = inline;
    else if (next !== undefined && !next.startsWith('--')) {
      out[key!] = next;
      i++;
    } else out[key!] = 'true';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const partyCode = (args.party ?? args.code ?? '').toUpperCase();
if (!partyCode) {
  console.error('usage: bots --party CODE [--n 5] [--url http://localhost:8080] [--interval 1500] [--buy-in 10]');
  process.exit(1);
}
const url = args.url ?? `http://localhost:${process.env.PORT ?? 8080}`;
const n = Math.max(1, Math.min(12, Number(args.n ?? 5) || 5));

try {
  const opts: Parameters<typeof runBots>[0] = {
    url,
    partyCode,
    n,
    intervalMs: Number(args.interval ?? 1500) || 1500,
    log: (line) => console.log(line),
  };
  if (args['buy-in']) opts.buyIn = Math.round(Number(args['buy-in']) * 1_000_000);
  if (args.seed) opts.seed = Number(args.seed);
  const handle = await runBots(opts);
  console.log(`${n} bots are playing party ${partyCode} at ${url}. Ctrl+C to stop.`);
  const report = setInterval(() => {
    const s = handle.stats;
    console.log(`actions ${s.actions}, accepted ${s.accepted}, rejected ${JSON.stringify(s.rejected)}`);
  }, 10_000);
  const quit = (): void => {
    clearInterval(report);
    handle.close();
    console.log('bots stopped', JSON.stringify(handle.stats));
    process.exit(0);
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  await handle.done;
  console.log('party finalized; final payouts:');
  const snap = handle.bots[0]?.client.getView().snapshot;
  for (const p of snap?.players ?? []) console.log(`  ${p.name.padEnd(16)} ${((p.payout ?? 0) / 1_000_000).toFixed(2)}`);
  quit();
} catch (e) {
  console.error(`bots failed: ${(e as Error).message}`);
  process.exit(1);
}
