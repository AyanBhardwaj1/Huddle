import { buildStaleUis } from '../scripts/lib/build';

/** The engine serves apps/box/dist and apps/player/dist: build them if missing or stale. */
export default function globalSetup(): void {
  buildStaleUis(undefined, (line) => console.log(`[e2e] ${line}`));
}
