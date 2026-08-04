/**
 * Drape API — unit test configuration.
 * End-to-end tests use their own config: `apps/api/test/jest-e2e.json`.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts', 'node'],
  roots: ['<rootDir>/apps', '<rootDir>/libs'],

  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: false }],
  },

  // Must mirror `compilerOptions.paths` in tsconfig.json exactly.
  moduleNameMapper: {
    '^@library/common$': '<rootDir>/libs/common/src',
    '^@library/common/(.*)$': '<rootDir>/libs/common/src/$1',
    '^@library/database$': '<rootDir>/libs/database/src',
    '^@library/database/(.*)$': '<rootDir>/libs/database/src/$1',
    '^@library/storage$': '<rootDir>/libs/storage/src',
    '^@library/storage/(.*)$': '<rootDir>/libs/storage/src/$1',
    '^@library/notifications$': '<rootDir>/libs/notifications/src',
    '^@library/notifications/(.*)$': '<rootDir>/libs/notifications/src/$1',
    '^@api/(.*)$': '<rootDir>/apps/api/src/$1',
  },

  setupFilesAfterEnv: ['<rootDir>/apps/api/test/setup/jest.setup.ts'],

  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/coverage/'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],

  clearMocks: true,
  restoreMocks: true,

  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  collectCoverageFrom: [
    'apps/**/*.ts',
    'libs/**/*.ts',
    '!**/*.module.ts',
    '!**/*.entity.ts',
    '!**/main.ts',
    '!**/migrations/**',
    '!**/data-sources/**',
    '!**/seeders/**',
    // Executable CLIs — exercised by CI (migration run/revert, seed, guard check)
    // rather than by unit tests, so they must not drag the global threshold.
    '!**/scripts/**',
    '!**/bootstrap/**',
    '!**/*.spec.ts',
    '!**/*.d.ts',
    '!**/test/**',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageThreshold: {
    global: {
      lines: 70,
      statements: 70,
    },
  },
};
