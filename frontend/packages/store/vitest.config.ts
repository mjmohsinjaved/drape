import { defineConfig } from 'vitest/config';

// Pin the timezone so timestamp assertions are identical on a dev machine (PKT) and in CI (UTC).
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
    },
  },
});
