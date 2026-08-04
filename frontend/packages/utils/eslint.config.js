import { baseConfig } from '@repo/config-eslint/base';

export default [
  ...baseConfig,
  {
    files: ['src/**/*.test.ts'],
    rules: {
      // Vitest globals (describe/it/expect) come from `types: ["vitest/globals"]`.
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
];
