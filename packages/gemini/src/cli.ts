/**
 * Bounty demo: print live Gemini Prediction Markets and mids for a team.
 *
 *   pnpm --filter @huddle/gemini demo -- "49ers"
 *   pnpm --filter @huddle/gemini demo -- Dallas --json
 *
 * Public reads only, no API key. `GEMINI_API_BASE` overrides the host.
 */
import { findGeminiMarkets, formatMarkets } from './demo';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const json = args.includes('--json');
  const terms = args.filter((a) => !a.startsWith('--'));
  if (terms.length === 0) terms.push('Dallas');
  const opts = process.env.GEMINI_API_BASE ? { base: process.env.GEMINI_API_BASE, timeoutMs: 8000 } : { timeoutMs: 8000 };
  for (const term of terms) {
    try {
      const found = await findGeminiMarkets(term, opts);
      console.log(json ? JSON.stringify(found, null, 2) : formatMarkets(found));
    } catch (err) {
      console.error(`Gemini lookup for "${term}" failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
    console.log('');
  }
}

void main();
