import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Timeout for individual tests (ms)
    testTimeout: 30_000,
  },
});
