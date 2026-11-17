import { defineConfig } from 'vitest/config';

/** Tests for the root scripts (QuickNode filter + webhook). Run by `pnpm test` after the package tests. */
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['**/*.test.ts'],
    testTimeout: 60_000,
  },
});
