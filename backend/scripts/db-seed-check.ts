import { NestFactory } from '@nestjs/core';

import { DataSource, In, IsNull, Not } from 'typeorm';

import { Role, UserStatus } from '@library/common';

import { ApiModule } from '@api/api.module';
import { Category } from '@api/modules/categories/entities/category.entity';
import { PolicyVersion } from '@api/modules/consents/entities/policy-version.entity';
import { Setting } from '@api/modules/settings/entities/setting.entity';
import { ReferenceModel } from '@api/modules/tryon/entities/reference-model.entity';
import { User } from '@api/modules/users/entities/user.entity';
import { CATEGORY_SEEDS } from '@api/seeders/categories.seeder';
import { SETTINGS_KEY_VALUES } from '@api/shared/constants/settings-keys.constant';

import { loadEnvFile } from './load-env';

/**
 * Verifies that `npm run seed` produced what the application needs before it will behave
 * correctly. Useful in CI, and useful the first time someone points the API at a database
 * that turns out to be one migration behind.
 *
 * It asserts the *invariants*, not the exact rows: an admin may have renamed every
 * category and raised the default quota, and this must still pass. What it will not
 * tolerate is a missing settings key (an unreadable feature toggle), no current policy
 * version (C-12 gates every photo upload on one), two default reference models (the A-11
 * gate would not know which to use), or no admin at all (nobody can sign in).
 *
 * Reuses the seeders' own exported lists, so it can never check against a stale copy.
 */

const CHECK_NAME_WIDTH = 34;

interface CheckOutcome {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
  /** Non-fatal observation printed alongside a passing check. */
  readonly warning?: string;
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function checkAdmin(dataSource: DataSource): Promise<CheckOutcome> {
  const repository = dataSource.getRepository(User);

  const usableAdmins = await repository.count({
    where: { role: Role.ADMIN, status: UserStatus.ACTIVE, emailVerifiedAt: Not(IsNull()) },
  });

  if (usableAdmins === 0) {
    const anyAdmins = await repository.count({ where: { role: Role.ADMIN } });
    return {
      name: 'first admin (E-4)',
      passed: false,
      detail:
        anyAdmins === 0
          ? 'no ADMIN account exists — run `npm run seed` with SEED_ADMIN_* set'
          : `${anyAdmins} ADMIN account(s) exist but none is ACTIVE with a verified email`,
    };
  }

  return {
    name: 'first admin (E-4)',
    passed: true,
    detail: `${usableAdmins} active, verified admin(s)`,
  };
}

async function checkSettings(dataSource: DataSource): Promise<CheckOutcome> {
  // The closed registry itself, not a copy of it — a key added there and not seeded is
  // exactly the failure this check exists to catch.
  const expected = [...SETTINGS_KEY_VALUES];
  const present = await dataSource.getRepository(Setting).find({
    select: { key: true },
    where: { key: In(expected) },
  });

  const presentKeys = new Set(present.map((row) => row.key));
  const missing = expected.filter((key) => !presentKeys.has(key));

  return missing.length === 0
    ? { name: 'settings keys (§4.28)', passed: true, detail: `all ${expected.length} keys present` }
    : {
        name: 'settings keys (§4.28)',
        passed: false,
        detail: `missing ${missing.length}: ${missing.join(', ')}`,
      };
}

async function checkPolicyVersion(dataSource: DataSource): Promise<CheckOutcome> {
  const repository = dataSource.getRepository(PolicyVersion);
  const total = await repository.count();
  const current = await repository.count({ where: { isCurrent: true } });

  if (current === 1) {
    return {
      name: 'current policy version (C-12)',
      passed: true,
      detail: `1 current of ${total} version(s)`,
    };
  }

  return {
    name: 'current policy version (C-12)',
    passed: false,
    detail:
      current === 0
        ? `${total} policy version(s), none marked current — consent cannot be granted`
        : `${current} versions marked current — UQ_policy_versions_current should make this impossible`,
  };
}

async function checkCategories(dataSource: DataSource): Promise<CheckOutcome> {
  const expected = CATEGORY_SEEDS.map((seed) => seed.slug);
  const present = await dataSource.getRepository(Category).find({
    select: { slug: true },
    where: { slug: In(expected) },
  });

  const presentSlugs = new Set(present.map((row) => row.slug));
  const missing = expected.filter((slug) => !presentSlugs.has(slug));

  // A-4's list is an example taxonomy. A studio that renamed or replaced it is fine, so a
  // missing slug is a warning unless the table is empty altogether.
  if (missing.length === 0) {
    return {
      name: 'example categories (A-4)',
      passed: true,
      detail: `all ${expected.length} seeded slugs present`,
    };
  }

  const total = await dataSource.getRepository(Category).count();
  if (total === 0) {
    return {
      name: 'example categories (A-4)',
      passed: false,
      detail: 'no categories at all — run `npm run seed`',
    };
  }

  return {
    name: 'example categories (A-4)',
    passed: true,
    detail: `${total} categor(ies) present`,
    warning: `${missing.length} seeded slug(s) absent (renamed or replaced?): ${missing.join(', ')}`,
  };
}

async function checkReferenceModels(dataSource: DataSource): Promise<CheckOutcome> {
  const repository = dataSource.getRepository(ReferenceModel);
  const active = await repository.count({ where: { active: true } });
  const defaults = await repository.count({ where: { isDefault: true } });

  if (active === 0) {
    return {
      name: 'reference models (A-11, E-4)',
      passed: false,
      detail: 'no active reference model — the test-render gate has nothing to render against',
    };
  }
  if (defaults !== 1) {
    return {
      name: 'reference models (A-11, E-4)',
      passed: false,
      detail: `${defaults} rows marked isDefault — exactly one is required`,
    };
  }

  return {
    name: 'reference models (A-11, E-4)',
    passed: true,
    detail: `${active} active, 1 default`,
    warning:
      'seeded models are generated placeholders — replace with real photography before production',
  };
}

export async function checkSeed(): Promise<boolean> {
  loadEnvFile();

  const app = await NestFactory.createApplicationContext(ApiModule, {
    logger: ['error'],
    abortOnError: false,
  });

  try {
    const dataSource = app.get(DataSource);

    const outcomes: CheckOutcome[] = [
      await checkAdmin(dataSource),
      await checkSettings(dataSource),
      await checkPolicyVersion(dataSource),
      await checkCategories(dataSource),
      await checkReferenceModels(dataSource),
    ];

    write('db-seed-check — verifying the seeded baseline.');
    write('');
    for (const outcome of outcomes) {
      write(
        `  ${outcome.passed ? 'PASS' : 'FAIL'}  ${outcome.name.padEnd(CHECK_NAME_WIDTH)}  ${outcome.detail}`,
      );
      if (outcome.warning !== undefined) {
        write(`  warn  ${''.padEnd(CHECK_NAME_WIDTH)}  ${outcome.warning}`);
      }
    }

    const failed = outcomes.filter((outcome) => !outcome.passed);
    write('');
    if (failed.length === 0) {
      write(`All ${outcomes.length} checks passed.`);
      return true;
    }

    write(`${failed.length} of ${outcomes.length} checks failed. Run: npm run seed`);
    write('(seeders live in apps/api/src/seeders/)');
    return false;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void checkSeed()
    .then((passed) => {
      if (!passed) {
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `\ndb-seed-check: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
