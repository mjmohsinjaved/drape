import eslintJs from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import turboPlugin from 'eslint-plugin-turbo';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Paths that are never linted anywhere in the workspace.
 * Flat config treats a bare `{ ignores }` object as global ignores.
 */
export const ignores = {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/*.d.ts',
    '**/next-env.d.ts',
  ],
};

/**
 * Import ordering: builtin → external → internal (`@repo/**`) → parent → sibling → index,
 * alphabetised case-insensitively, one blank line between groups.
 */
export const importOrderRule = [
  'error',
  {
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
    pathGroups: [
      { pattern: 'react', group: 'builtin', position: 'before' },
      { pattern: 'react-dom/**', group: 'builtin', position: 'before' },
      { pattern: 'next', group: 'builtin', position: 'before' },
      { pattern: 'next/**', group: 'builtin', position: 'before' },
      { pattern: '@repo/**', group: 'internal', position: 'before' },
      { pattern: '@/**', group: 'internal', position: 'after' },
    ],
    pathGroupsExcludedImportTypes: ['builtin', 'type'],
    'newlines-between': 'always',
    alphabetize: { order: 'asc', caseInsensitive: true },
    warnOnUnassignedImports: false,
  },
];

/**
 * The Drape base config. Everything else in this package builds on it.
 * `eslint-config-prettier` is appended LAST so it wins over any stylistic rule above it.
 */
export const baseConfig = tseslint.config(
  ignores,
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    plugins: {
      import: importPlugin,
      turbo: turboPlugin,
    },
    settings: {
      'import/resolver': {
        node: { extensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json'] },
      },
      'import/internal-regex': '^@repo/',
    },
    rules: {
      // --- Non-negotiables from CLAUDE.md -------------------------------------
      '@typescript-eslint/no-explicit-any': 'error',
      // Structured logging only. The web app reports through an error boundary /
      // monitoring hook, never through the console.
      'no-console': 'error',

      // --- Type-import hygiene -------------------------------------------------
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: true },
      ],
      '@typescript-eslint/consistent-type-exports': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'error',

      // --- Correctness ---------------------------------------------------------
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-debugger': 'error',
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'object-shorthand': ['error', 'properties'],

      // --- Imports -------------------------------------------------------------
      'import/order': importOrderRule,
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      'import/newline-after-import': 'error',
      'import/no-self-import': 'error',
      'import/no-useless-path-segments': ['error', { noUselessIndex: true }],

      // --- Turborepo -----------------------------------------------------------
      // Fails on any process.env read that is not declared in turbo.json.
      'turbo/no-undeclared-env-vars': 'error',
    },
  },
  {
    // Config and tooling files are plain Node scripts.
    files: ['**/*.config.{js,cjs,mjs,ts,mts}', '**/eslint.config.{js,mjs}', '**/scripts/**'],
    rules: {
      'no-console': 'off',
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/test/**', '**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettierConfig,
);

export default baseConfig;
