/**
 * Drape API — ESLint configuration (eslintrc format, ESLint 8).
 *
 * Non-negotiables enforced here (docs/ARCHITECTURE.md §0, CLAUDE.md):
 *   - `any` is a review failure.
 *   - `console` is a review failure — use the Nest Logger / structured logger.
 *   - Floating promises are errors.
 *   - Libraries never import from the application (`libs/*` must not see `@api/*`).
 *   - Always import from a library barrel, never a deep path.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
    ecmaVersion: 2022,
  },
  plugins: ['@typescript-eslint', 'import', 'prettier'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    // NOTE: typescript-eslint v8 renamed `recommended-requiring-type-checking`
    // to `recommended-type-checked`. Same rule set, current name.
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:prettier/recommended',
    'prettier',
  ],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '**/*.js', '**/*.mjs', '**/*.cjs'],
  settings: {
    'import/resolver': {
      typescript: {
        project: './tsconfig.json',
        alwaysTryTypes: true,
      },
      node: true,
    },
  },
  rules: {
    // ── Type safety ────────────────────────────────────────────────────────
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-unsafe-declaration-merging': 'error',
    '@typescript-eslint/no-unsafe-enum-comparison': 'error',
    '@typescript-eslint/no-unsafe-function-type': 'error',
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      { allowExpressions: true, allowTypedFunctionExpressions: true, allowHigherOrderFunctions: true },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],

    // ── Async correctness ──────────────────────────────────────────────────
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/require-await': 'error',

    // ── Logging ────────────────────────────────────────────────────────────
    'no-console': 'error',
    'no-debugger': 'error',

    // ── Import hygiene ─────────────────────────────────────────────────────
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        pathGroups: [
          { pattern: '@nestjs/**', group: 'external', position: 'before' },
          { pattern: '@library/**', group: 'internal', position: 'before' },
          { pattern: '@api/**', group: 'internal', position: 'after' },
        ],
        pathGroupsExcludedImportTypes: ['@nestjs/**'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-duplicates': 'error',
    'import/no-cycle': ['error', { maxDepth: 4 }],
    'import/no-default-export': 'error',
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@library/*/*', '@library/*/**'],
            message:
              'Import from the library barrel (e.g. `@library/common`), never a deep path — docs/ARCHITECTURE.md §1.1.',
          },
        ],
      },
    ],

    // ── Style / correctness ────────────────────────────────────────────────
    eqeqeq: ['error', 'smart'],
    'prefer-const': 'error',
    'no-return-await': 'off',
    '@typescript-eslint/return-await': ['error', 'in-try-catch'],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
  overrides: [
    {
      // Libraries know nothing about the application (docs/ARCHITECTURE.md §1.1).
      files: ['libs/**/*.ts'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@api/*', '@api/**', '**/apps/**'],
                message: 'libs/* must not import from the application. Libraries stay app-agnostic.',
              },
              {
                group: ['@library/*/*', '@library/*/**'],
                message: 'Import from the library barrel, never a deep path.',
              },
            ],
          },
        ],
      },
    },
    {
      // Data sources and TypeORM migrations legitimately default-export.
      files: [
        'libs/database/src/data-sources/*.ts',
        'libs/database/src/migrations/**/*.ts',
        'jest.config.js',
      ],
      rules: {
        'import/no-default-export': 'off',
      },
    },
    {
      files: ['**/*.spec.ts', 'apps/api/test/**/*.ts'],
      rules: {
        '@typescript-eslint/unbound-method': 'off',
        // A test double is frequently `async () => value` with nothing to await —
        // it exists to satisfy a Promise-returning contract, and dropping `async`
        // would change what the double returns.
        '@typescript-eslint/require-await': 'off',
        // Tests deliberately throw non-Error values to prove the error handling
        // copes with them.
        '@typescript-eslint/only-throw-error': 'off',
        // Assertions reach into loosely-typed captured mock arguments.
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },
  ],
};
