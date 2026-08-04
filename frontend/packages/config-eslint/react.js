import prettierConfig from 'eslint-config-prettier';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';

/**
 * Two bans, both enforced as errors because `apps/web` and `@repo/ui` lint with
 * `--max-warnings 0` and both rules protect a contract rather than a preference:
 *
 * 1. **§6.7 / RTL** — Drape ships an Urdu locale, so layout is expressed with *logical*
 *    properties (`ms`/`me`, `ps`/`pe`, `start`/`end`, `border-s`/`border-e`). A physical side
 *    does not mirror, and the bug only shows up for Urdu readers.
 * 2. **D-1 tokens** — colours and spacing come from the design tokens in
 *    `@repo/config-tailwind`. A hex literal or an arbitrary `w-[13px]` value bypasses the
 *    token scale and the contrast budget.
 *
 * The Tailwind selectors deliberately match arbitrary *values* (`w-[13px]`, `text-[#fff]`)
 * and not arbitrary *variants* (`data-[state=open]:`, `has-[:checked]:`), which are ordinary
 * Radix/Tailwind usage and must keep working.
 */
export const designSystemRestrictions = [
  'error',
  {
    selector:
      "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)-?(ml-|mr-|pl-|pr-|left-|right-|border-l|border-r|rounded-l|rounded-r|text-left|text-right|float-left|float-right)/]",
    message:
      'Use logical properties (ms/me, ps/pe, start/end, text-start/text-end, border-s/border-e) — Drape renders an RTL (ur) locale and physical sides do not mirror.',
  },
  {
    selector:
      "Property[key.name=/^(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)$/]",
    message:
      'Use CSS logical properties (marginInlineStart/End, paddingInlineStart/End, borderInlineStart/End, borderStartStartRadius, …) — Drape renders an RTL (ur) locale.',
  },
  {
    selector:
      "JSXAttribute[name.name=/^(className|style)$/] Literal[value=/#[0-9a-fA-F]{3}/]",
    message:
      'D-1: no hex colour literals. Use a design token from @repo/config-tailwind (bg-surface, text-muted, …).',
  },
  {
    selector:
      // The trailing (?!:) is what keeps arbitrary *variants* (`min-[600px]:flex`) legal
      // while still banning arbitrary *values* (`w-[13px]`).
      "JSXAttribute[name.name='className'] Literal[value=/-\\[-?[0-9.]+(px|rem|em|vh|vw|ch|%)\\](?!:)/]",
    message:
      'D-1: no arbitrary Tailwind values. Use the token scale from @repo/config-tailwind, or add a token if the scale is genuinely missing one.',
  },
];

/**
 * React config for non-Next packages (design system, shared component libraries).
 * Includes the full jsx-a11y recommended set — Drape must reach WCAG 2.1 AA.
 */
export const reactConfig = tseslint.config(
  ...baseConfig,
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,

      // TypeScript props interfaces replace prop-types entirely.
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
      'react/self-closing-comp': 'error',
      'react/jsx-boolean-value': ['error', 'never'],
      'react/no-array-index-key': 'warn',
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],

      // Hooks rules are load-bearing, never downgraded.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // WCAG 2.1 AA: these three catch the most common real-world failures.
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],

      'no-restricted-syntax': designSystemRestrictions,
    },
  },
  prettierConfig,
);

export default reactConfig;
