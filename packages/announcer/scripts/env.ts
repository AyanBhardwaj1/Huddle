import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = join(PACKAGE_DIR, '..', '..');

/**
 * Load `.env` from the repo root (then the current directory) without overriding variables that are
 * already set. Values are never printed.
 */
export function loadEnv(): NodeJS.ProcessEnv {
  for (const file of [join(REPO_ROOT, '.env'), join(process.cwd(), '.env')]) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch {
      console.warn(`Could not read ${file}; continuing with the current environment.`);
    }
  }
  return process.env;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}
