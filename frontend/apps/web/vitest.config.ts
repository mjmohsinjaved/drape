import { defineConfig } from 'vitest/config';

// Pin the timezone so any date assertion is identical on a dev machine (PKT) and in CI (UTC).
process.env.TZ = 'UTC';

/**
 * `apps/web` runs the checks that guard the *content* of the app rather than its behaviour:
 * the PRD §9.4 copy rules, the C-41 Urdu parity contract, and the §6.7 ban on physical CSS
 * sides. All three read source files from disk and assert on strings, so they need no DOM and
 * no React renderer — neither `jsdom` nor `@testing-library` is installed, and none is needed.
 *
 * Component behaviour is covered where the components live (`@repo/ui`, `@repo/store`,
 * `@repo/api-client`), which is where a component test can run without booting Next.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      enabled: false,
    },
  },
});
