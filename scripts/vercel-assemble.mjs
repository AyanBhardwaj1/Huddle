// Assemble the static Vercel site: the player PWA at `/` and the box kiosk UI at `/box/`.
// Run after `pnpm --filter @huddle/player --filter @huddle/box build` (see vercel.json).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel-site');
const player = join(root, 'apps/player/dist');
const box = join(root, 'apps/box/dist');
for (const d of [player, box]) if (!existsSync(join(d, 'index.html'))) throw new Error(`missing build: ${d}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(player, out, { recursive: true });
cpSync(box, join(out, 'box'), { recursive: true });
console.log(`assembled ${out} (player at /, box at /box/)`);
