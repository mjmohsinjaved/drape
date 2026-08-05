import { NodeEnv, type EnvironmentVariables } from '@api/config/env.validation';
import { validateEnv } from '@api/config/env.validation';

import { TEST_ENV } from '../../test/setup/test-env';

import { shouldExposeSwagger } from './swagger.config';

/**
 * `SwaggerModule.setup()` mounts `/api/docs` and `/api/docs-json` as **raw Express
 * middleware**. That is not a route handler, so none of the four `APP_GUARD`s in §2.7 runs on
 * it, `@Roles()` never applies, and `npm run check:guards` cannot see it — it walks route
 * decorators, and there are none.
 *
 * The rule used to be `NODE_ENV !== 'production'`, which meant **staging published the entire
 * API surface anonymously**: every path, every DTO, every error code, to anyone who could
 * reach the port. Exposure is now an explicit per-deployment decision that defaults to closed.
 */
describe('shouldExposeSwagger — the docs are opt-in (§7)', () => {
  function env(overrides: Partial<EnvironmentVariables>): EnvironmentVariables {
    return { ...(overrides as EnvironmentVariables) };
  }

  it.each([NodeEnv.DEVELOPMENT, NodeEnv.TEST, NodeEnv.STAGING, NodeEnv.PRODUCTION])(
    'is closed in %s when the flag is absent — the default is false, not "not production"',
    (nodeEnv) => {
      expect(shouldExposeSwagger(env({ NODE_ENV: nodeEnv, EXPOSE_API_DOCS: false }))).toBe(false);
    },
  );

  it.each([NodeEnv.DEVELOPMENT, NodeEnv.TEST, NodeEnv.STAGING])(
    'opens in %s only when EXPOSE_API_DOCS is explicitly true',
    (nodeEnv) => {
      expect(shouldExposeSwagger(env({ NODE_ENV: nodeEnv, EXPOSE_API_DOCS: true }))).toBe(true);
    },
  );

  it('stays shut in production even with the flag on — belt and braces', () => {
    expect(shouldExposeSwagger(env({ NODE_ENV: NodeEnv.PRODUCTION, EXPOSE_API_DOCS: true }))).toBe(
      false,
    );
  });

  /**
   * The §7 default has to survive the environment parser, not just this function: a variable
   * that silently coerces a missing value to `true` would reopen the hole one layer down.
   */
  describe('the §7 default', () => {
    /**
     * `test-env.ts` is tuned for unit tests and three of its values sit below what the real
     * §7 gate accepts — the same three `test/boot/api-module.spec.ts` restores, and for the
     * same reason: nothing here weakens `validateEnv`, the fixture is brought up to meet it.
     */
    const VALID_ENV: Readonly<Record<string, string>> = {
      ...TEST_ENV,
      API_PORT: '4000',
      ARGON2_MEMORY_KIB: '19456',
      SMTP_SECURE: 'false',
    };

    it('is false when the variable is not set at all', () => {
      const withoutFlag = { ...VALID_ENV };
      delete (withoutFlag as Record<string, string | undefined>).EXPOSE_API_DOCS;

      expect(validateEnv(withoutFlag).EXPOSE_API_DOCS).toBe(false);
      expect(shouldExposeSwagger(validateEnv(withoutFlag))).toBe(false);
    });

    it.each([
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ])('parses %s as %s', (raw, expected) => {
      expect(validateEnv({ ...VALID_ENV, EXPOSE_API_DOCS: raw }).EXPOSE_API_DOCS).toBe(expected);
    });
  });
});
