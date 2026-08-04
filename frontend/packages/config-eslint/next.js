import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

import { reactConfig } from './react.js';

/**
 * Config for the Next.js app (`apps/web`).
 * base → react (react + react-hooks + jsx-a11y, WCAG 2.1 AA) → @next/next core-web-vitals.
 */
export const nextConfig = tseslint.config(
  ...reactConfig,
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    // `next.config.ts` and the App Router's generated files are not app source.
    ignores: ['**/.next/**', '**/next-env.d.ts'],
  },
  prettierConfig,
);

export default nextConfig;
