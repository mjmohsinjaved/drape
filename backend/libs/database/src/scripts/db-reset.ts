/**
 * `db-reset` — drop everything in the `public` schema and rebuild it from the migrations in
 * `libs/database/src/migrations/api`.
 *
 *   ts-node -r tsconfig-paths/register libs/database/src/scripts/db-reset.ts --yes
 *
 * This is a **local development convenience**. It is not a deployment tool, not a repair
 * tool, and not something to reach for when a migration misbehaves in staging — fix that
 * forward with a new migration (see the README in `migrations/api`).
 *
 * Two guards, both deliberate:
 *
 * 1. It refuses outright when `NODE_ENV=production`. There is no flag, no environment
 *    variable and no argument that overrides this. PRD E-3: no destructive operation runs
 *    without a verified backup, and a script cannot verify one.
 * 2. It refuses without an explicit `--yes` (or `-y`). A destructive command must be typed
 *    on purpose, never inherited from shell history or a stale npm script.
 *
 * It does not seed. Run `npm run seed` afterwards.
 */
import { Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { apiDataSourceOptions } from '../data-sources/api.data-source';

const logger = new Logger('db-reset');

const PRODUCTION = 'production';

async function main(): Promise<number> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (nodeEnv === PRODUCTION) {
    logger.error(
      'Refusing to run: NODE_ENV=production. db-reset destroys every row in the database and cannot verify a backup exists (PRD E-3). If a production schema truly must be rebuilt, that is a runbook procedure with a restored-and-verified backup, not a script.',
    );
    return 1;
  }

  const args = process.argv.slice(2);
  if (!args.includes('--yes') && !args.includes('-y')) {
    logger.error(
      `Refusing to run without confirmation. This DROPS the entire "public" schema of the configured database (NODE_ENV=${nodeEnv}). Re-run with --yes if that is what you want.`,
    );
    return 1;
  }

  const dataSource = new DataSource(apiDataSourceOptions);

  try {
    await dataSource.initialize();

    const [{ database }] = await dataSource.query<Array<{ database: string }>>(
      'SELECT current_database() AS "database"',
    );
    logger.warn(`Dropping and rebuilding schema "public" in database "${database}"...`);

    // DROP SCHEMA rather than dropDatabase(): it also removes the PostgreSQL enum types
    // (§4.1) and the api_migrations tracking table, so the rebuild starts from nothing.
    await dataSource.query('DROP SCHEMA IF EXISTS "public" CASCADE');
    await dataSource.query('CREATE SCHEMA "public"');
    logger.log('Schema dropped and recreated.');

    const applied = await dataSource.runMigrations({ transaction: 'each' });
    if (applied.length === 0) {
      logger.warn(
        'No migrations were applied — libs/database/src/migrations/api is empty. The database is now schemaless.',
      );
    } else {
      for (const migration of applied) {
        logger.log(`Applied ${migration.name}`);
      }
      logger.log(`${applied.length} migration(s) applied. Run "npm run seed" next.`);
    }

    return 0;
  } catch (error) {
    logger.error(`db-reset failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void main().then((code) => {
  process.exitCode = code;
});
