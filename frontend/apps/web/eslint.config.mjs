import nextConfig from '@repo/config-eslint/next';

/**
 * `apps/web` lint config.
 *
 * The shared `next` config already carries: typescript-eslint (strict, no `any`),
 * react + react-hooks, jsx-a11y at WCAG 2.1 AA, `@next/next` core-web-vitals,
 * the D-1 ban on hex literals / arbitrary Tailwind values, and the §6.7 ban on
 * physical CSS sides (`ml-*`, `pr-*`, `left-*`, `text-left`, …). Nothing is
 * relaxed here — only app-specific paths are added.
 */
export default [
  {
    ignores: ['.next/**', 'next-env.d.ts', '.turbo/**', 'coverage/**', 'public/**'],
  },
  ...nextConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // CLAUDE.md non-negotiable: no `console.log` anywhere in the app.
      'no-console': 'error',
      // B-9: Server Components read through `@/lib/server-api`; the browser goes
      // through `@repo/api-client`. A raw `fetch` in a component is a review failure.
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Use @repo/api-client (browser) or @/lib/server-api (Server Components). No raw fetch in components — B-9.',
        },
      ],
    },
  },
  {
    // The session/brand server helpers and the middleware are the only places allowed
    // to speak HTTP directly, because they run before/outside the api-client contract.
    files: ['src/lib/server-api.ts', 'src/lib/session.ts', 'src/lib/brand.ts', 'src/middleware.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
];
