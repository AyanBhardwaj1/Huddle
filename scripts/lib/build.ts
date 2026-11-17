/** Shared by `pnpm demo` and the e2e global setup: rebuild the two UIs only when needed. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export type UiApp = 'box' | 'player';

function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/** dist/ is stale when it is missing or any source file of the app (or of @huddle/shared) is newer than its index.html. */
export function needsBuild(app: UiApp, root = ROOT): boolean {
  const index = path.join(root, 'apps', app, 'dist', 'index.html');
  if (!fs.existsSync(index)) return true;
  const built = fs.statSync(index).mtimeMs;
  const sources = [path.join(root, 'apps', app, 'src'), path.join(root, 'apps', app, 'index.html'), path.join(root, 'packages', 'shared', 'src')];
  if (app === 'player') sources.push(path.join(root, 'apps', app, 'public'));
  return sources.some((s) => {
    if (!fs.existsSync(s)) return false;
    const st = fs.statSync(s);
    return (st.isDirectory() ? newestMtime(s) : st.mtimeMs) > built;
  });
}

/** Build the stale UIs with pnpm. Returns the apps that were built; throws if the build fails. */
export function buildStaleUis(root = ROOT, log: (line: string) => void = console.log): UiApp[] {
  const stale = (['box', 'player'] as const).filter((app) => needsBuild(app, root));
  if (!stale.length) return [];
  log(`building ${stale.join(' + ')} UI (dist missing or older than the source)…`);
  const filters = stale.flatMap((app) => ['--filter', `@huddle/${app}`]);
  const r = spawnSync('pnpm', [...filters, 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('UI build failed (see above)');
  return stale;
}
