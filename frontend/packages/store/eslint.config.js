import { reactConfig } from '@repo/config-eslint/react';

export default [
  ...reactConfig,
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
];
