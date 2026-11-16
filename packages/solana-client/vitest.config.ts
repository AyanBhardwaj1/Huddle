import { defineConfig } from 'vitest/config';

// On-chain suites (tests/) talk to one local validator: run files one at a time, with room for
// confirmations and challenge windows. They skip themselves when no validator is configured.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
