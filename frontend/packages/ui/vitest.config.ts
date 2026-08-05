import { defineConfig } from 'vitest/config';

// Pin the timezone so any date assertion is identical on a dev machine (PKT) and in CI (UTC).
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    // The design-system tests that exist today are pure: they read token values out of
    // `tokens.css` and compute WCAG ratios from them. No DOM is required, and none is installed.
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/tokens/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/index.ts'],
    },
  },
});
