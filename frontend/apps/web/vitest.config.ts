import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

// Pin the timezone so any date assertion is identical on a dev machine (PKT) and in CI (UTC).
process.env.TZ = 'UTC';

/**
 * `apps/web` runs two kinds of check.
 *
 * **Source checks** (`environment: 'node'`, the default below) guard the *content* of the app:
 * the PRD §9.4 copy rules, the C-41 Urdu parity contract, the §6.7 ban on physical CSS sides and
 * the §9.1 namespace split. They read files from disk and assert on strings.
 *
 * **Behaviour checks** render. Every one of them opens with `// @vitest-environment jsdom` and
 * drives a real component through Testing Library. They exist because the two worst defects this
 * app has shipped — a locale prefix applied twice, so the try-on reveal 404'd, and a tray that
 * never reconciled a job once its wait screen unmounted — are both invisible to a check that only
 * reads source: every file involved type-checks, lints and reads correctly. Neither is reachable
 * without a renderer, so a renderer is part of the suite.
 */
export default defineConfig({
  // tsconfig says `jsx: preserve` because Next owns the transform; the test runner needs a real
  // one. `automatic` matches React 19's runtime — no `import React` in a test file.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
      // `next/font` is a build-time transform. See the note in the stub.
      'next/font/google': resolve(import.meta.dirname, './src/test/next-font-google.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    /*
      Vitest's 5 s default is a per-*test* budget, and the first test in each behaviour file pays
      for the whole module graph beneath it: the design system, next-intl, and the real message
      catalogue for its route group. In isolation that is ~200 ms; under `turbo run test`, with
      every workspace compiling in parallel on a loaded machine, it went past 5 s and timed out on
      first-run only — a flake that says nothing about the code. Raised for the runner, not to let
      a slow assertion through: everything here still settles through `waitFor`.
    */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: {
      deps: {
        // `next` ships no `exports` map, so Node cannot resolve the extensionless
        // `next/navigation` that next-intl imports. Transforming next-intl through vite lets
        // vite's resolver — which knows about extensions — answer it instead.
        inline: ['next-intl'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      enabled: false,
    },
  },
});
