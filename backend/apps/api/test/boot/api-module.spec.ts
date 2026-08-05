import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getEntityManagerToken } from '@nestjs/typeorm';

import { SESSION_RESOLVER, type SessionResolver } from '@library/common';

import { AuditController } from '@api/modules/audit/controllers/audit.controller';
import { AuditListener } from '@api/modules/audit/listeners/audit.listener';
import {
  AUTH_CONFIG,
  INVITED_ACCOUNT_DIRECTORY,
  USER_DIRECTORY,
} from '@api/modules/auth/auth.constants';
import { AuthController } from '@api/modules/auth/controllers/auth.controller';
import { InviteAcceptanceController } from '@api/modules/auth/controllers/invite-acceptance.controller';
import type { InvitedAccountDirectory } from '@api/modules/auth/interfaces/invited-account-directory.interface';
import type { UserDirectory } from '@api/modules/auth/interfaces/user-directory.interface';
import { InviteAcceptanceService } from '@api/modules/auth/services/invite-acceptance.service';
import { SessionResolverService } from '@api/modules/auth/services/session-resolver.service';
import { SessionRevocationService } from '@api/modules/auth/services/session-revocation.service';
import { ConsentsController } from '@api/modules/consents/controllers/consents.controller';
import { PolicyAdminController } from '@api/modules/consents/controllers/policy-admin.controller';
import { HealthController } from '@api/modules/health/controllers/health.controller';
import { InvitesController } from '@api/modules/invites/controllers/invites.controller';
import { InvitesService } from '@api/modules/invites/services/invites.service';
import { SettingsController } from '@api/modules/settings/controllers/settings.controller';
import { AdminConsumersController } from '@api/modules/users/controllers/admin-consumers.controller';
import { AdminUsersController } from '@api/modules/users/controllers/admin-users.controller';
import { MeController } from '@api/modules/users/controllers/me.controller';
import { SESSION_REVOCATION } from '@api/modules/users/interfaces/session-revocation.interface';
import type { SessionRevocationPort } from '@api/modules/users/interfaces/session-revocation.interface';
import { AdminConsumersService } from '@api/modules/users/services/admin-consumers.service';
import { AdminUsersService } from '@api/modules/users/services/admin-users.service';
import { InvitedAccountDirectoryService } from '@api/modules/users/services/invited-account-directory.service';
import { UserDirectoryService } from '@api/modules/users/services/user-directory.service';

import { createInMemoryDataSource } from '../fixtures';
import { TEST_SEED_ENV } from '../setup/test-env';

/**
 * **The boot test.** Builds the real `ApiModule` DI graph and compiles it.
 *
 * Six feature modules were written in parallel against seams none of them owned, and
 * for a while the application could not start: `AuthModule` injected `USER_DIRECTORY`
 * with nothing bound to it, and `UsersModule` bound `SESSION_REVOCATION` to a no-op
 * that revoked nothing. Neither failure is visible to a unit test — every one of them
 * passes a hand-built module with the collaborator mocked — and there is no
 * PostgreSQL on this machine to run the API against (CLAUDE.md). This closes that
 * gap: `Test.createTestingModule({ imports: [ApiModule] }).compile()` resolves every
 * provider in every module, so a missing provider, an unresolvable token or a
 * circular module dependency fails **here**, loudly, in the normal `npm test` sweep.
 *
 * ### What is substituted, and only what
 *
 * Exactly two tokens: the TypeORM `DataSource` and its `EntityManager`. Everything
 * else — the guard chain, the throttler, the scheduler, the event emitter, storage,
 * notifications, metrics and all six feature modules — is the real registration from
 * `api.module.ts`. Repository providers are *not* overridden one by one: each is a
 * factory that calls `dataSource.getRepository(entity)`, so the in-memory data source
 * satisfies them all and an entity added tomorrow needs no edit here. A missing
 * *provider* still fails, because only repository tokens are covered.
 *
 * ### What this cannot cover
 *
 * - **Lifecycle hooks.** `compile()` constructs providers; it does not run
 *   `onModuleInit`. `DatabaseConnectionService` probes the database there and
 *   `LocalDiskDriver` creates its directories there, and neither can run on a machine
 *   with no PostgreSQL and no storage root.
 * - **HTTP.** No listener is bound, so route conflicts and pipe/interceptor behaviour
 *   are not exercised. `npm run check:guards` covers the `@Roles()` contract, and the
 *   e2e config exists for the rest.
 * - **SQL.** The in-memory repository refuses `createQueryBuilder()` on purpose, and
 *   no migration is applied. Column names, indexes and the append-only rules are not
 *   verified by anything here.
 *
 * ---
 *
 * `test-env.ts` is tuned for unit tests, and three of its values are below what
 * `validateEnv` — the real §7 check `main.ts` runs before anything else — will accept:
 *
 * | Variable | Unit-test value | Why it cannot stay |
 * | --- | --- | --- |
 * | `API_PORT` | `0` (ask the OS for a free port) | §7 requires 1…65535 |
 * | `ARGON2_MEMORY_KIB` | `1024` (a suite that spends 8 s hashing is one nobody runs) | §7 floor is 8192 |
 * | `SMTP_SECURE` | unset | declared non-optional, so `plainToInstance` never applies its default |
 *
 * They are set to the §7 defaults for this file only and restored afterwards, because
 * the point of booting `ApiModule` is that the environment gate runs for real. Nothing
 * here weakens `validateEnv`; the test meets it.
 *
 * ### And the three seed variables, for a reason worth stating
 *
 * This is the only spec that boots the real `ConfigModule.forRoot`, and that reads
 * `.env.local` and `.env` — **a developer's own files**. `SEED_ADMIN_EMAIL` and its two
 * companions are `@IsOptional()`, so *unset* is fine; but `.env.example` declares them with
 * empty values, and `@IsOptional()` skips `null` and `undefined`, not `''`. A checkout whose
 * `.env` carries `SEED_ADMIN_EMAIL=` therefore fails `@IsEmail` and this whole file goes red
 * — for a reason that has nothing to do with the DI graph it exists to check, on one
 * machine and not another.
 *
 * `TEST_SEED_ENV` was written for exactly this ("a test that wants a working seed opts in
 * explicitly") and had no callers. Opting in here is what makes the suite a function of the
 * repository rather than of whatever is in someone's `.env`, and it leaves the seeder's own
 * "must throw when unset" test — which does its own unsetting — untouched.
 */
const BOOT_ENV: Readonly<Record<string, string>> = {
  API_PORT: '4000',
  ARGON2_MEMORY_KIB: '19456',
  SMTP_SECURE: 'false',
  ...TEST_SEED_ENV,
};

describe('ApiModule — the DI graph boots', () => {
  let moduleRef: TestingModule;
  const originalEnv = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const [key, value] of Object.entries(BOOT_ENV)) {
      originalEnv.set(key, process.env[key]);
      process.env[key] = value;
    }

    // Imported here, not at the top of the file: `api.module.ts` runs
    // `ConfigModule.forRoot({ validate: validateEnv })` at module-evaluation time, so
    // the environment above has to be in place before the module is loaded.
    const { ApiModule } = await import('@api/api.module');

    const database = createInMemoryDataSource();

    moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
      // Without this, `TypeOrmModule.forRootAsync`'s factory would try to connect to
      // the DATABASE_URL in `test-env.ts` — which is well-formed and deliberately
      // unreachable.
      .overrideProvider(getDataSourceToken())
      .useValue(database.dataSource)
      .overrideProvider(getEntityManagerToken())
      .useValue(database.manager)
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();

    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('compiles the whole composition root', () => {
    expect(moduleRef).toBeDefined();
  });

  /* ---------------------------------------------------------------------------------------
   * The seams that were open
   * ------------------------------------------------------------------------------------ */

  describe('the four cross-module seams resolve', () => {
    it('binds SESSION_RESOLVER — without it guard 3 cannot be constructed (§2.7)', () => {
      const resolver = moduleRef.get<SessionResolver>(SESSION_RESOLVER, { strict: false });

      expect(resolver).toBeInstanceOf(SessionResolverService);
    });

    it('binds USER_DIRECTORY to the users module, which owns the table (§4.33)', () => {
      const directory = moduleRef.get<UserDirectory>(USER_DIRECTORY, { strict: false });

      expect(directory).toBeInstanceOf(UserDirectoryService);
    });

    it('binds INVITED_ACCOUNT_DIRECTORY as a separate object, so USER_DIRECTORY cannot mint an admin (S-4)', () => {
      const invited = moduleRef.get<InvitedAccountDirectory>(INVITED_ACCOUNT_DIRECTORY, {
        strict: false,
      });
      const directory = moduleRef.get<UserDirectory>(USER_DIRECTORY, { strict: false });

      expect(invited).toBeInstanceOf(InvitedAccountDirectoryService);
      expect(invited).not.toBe(directory);
      expect('createInvitedAccount' in directory).toBe(false);
    });

    it('binds SESSION_REVOCATION to a real revoker, never a no-op (A-2, A-19)', () => {
      const revocation = moduleRef.get<SessionRevocationPort>(SESSION_REVOCATION, {
        strict: false,
      });

      expect(revocation).toBeInstanceOf(SessionRevocationService);
      // The class this replaced revoked nothing and logged at `error`. It is gone;
      // this assertion is what stops it, or anything like it, coming back.
      expect(revocation.constructor.name).not.toMatch(/noop/i);
    });

    it('resolves AUTH_CONFIG from the environment §7 rows', () => {
      expect(moduleRef.get(AUTH_CONFIG, { strict: false })).toBeDefined();
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Both sides of every port are the real object
   * ------------------------------------------------------------------------------------ */

  describe('the consumers of those seams construct', () => {
    it.each([
      ['AdminUsersService — A-2 deactivation', AdminUsersService],
      ['AdminConsumersService — A-19 suspension', AdminConsumersService],
      ['InviteAcceptanceService — S-5 acceptance', InviteAcceptanceService],
      ['InvitesService — the token it burns', InvitesService],
      ['SessionResolverService — guard 3', SessionResolverService],
      ['AuditListener — the §2.9 rule 4 listener', AuditListener],
    ])('%s', (_label, service) => {
      expect(moduleRef.get(service, { strict: false })).toBeInstanceOf(service);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Every controller the six modules register
   * ------------------------------------------------------------------------------------ */

  describe('every registered controller is constructible', () => {
    it.each([
      ['auth', AuthController],
      ['invite acceptance (auth owns the route, §5.3)', InviteAcceptanceController],
      ['invites', InvitesController],
      ['admin users', AdminUsersController],
      ['admin consumers', AdminConsumersController],
      ['me', MeController],
      ['settings', SettingsController],
      ['consents', ConsentsController],
      ['policy admin', PolicyAdminController],
      ['audit', AuditController],
      ['health', HealthController],
    ])('%s', (_label, controller) => {
      expect(moduleRef.get(controller, { strict: false })).toBeInstanceOf(controller);
    });
  });
});
