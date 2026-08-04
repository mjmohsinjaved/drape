/**
 * `db-check` — a read-only answer to "is the database reachable, and is its schema current?"
 *
 * Run it before a deploy, from the runbook when something looks wrong, and from CI once a
 * database is available. It changes nothing: no migration runs, no table is touched.
 *
 *   ts-node -r tsconfig-paths/register libs/database/src/scripts/db-check.ts
 *
 * Exit code 0 = reachable and no pending migrations. Exit code 1 = anything else.
 */
import { Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { apiDataSourceOptions } from '../data-sources/api.data-source';

const logger = new Logger('db-check');

interface ServerInfo {
  readonly version: string;
  readonly database: string;
  readonly user: string;
}

async function main(): Promise<number> {
  const dataSource = new DataSource(apiDataSourceOptions);

  try {
    const startedAt = Date.now();
    await dataSource.initialize();
    logger.log(`Connected in ${Date.now() - startedAt}ms`);

    const [info] = await dataSource.query<ServerInfo[]>(
      'SELECT version() AS "version", current_database() AS "database", current_user AS "user"',
    );
    // Credentials are never printed: the URL is not logged, only the resolved identity.
    logger.log(`Server: ${info.version.split(',')[0]}`);
    logger.log(`Database: ${info.database} (connected as ${info.user})`);

    const hasPending = await dataSource.showMigrations();
    if (hasPending) {
      logger.error(
        `Schema is BEHIND: pending migrations exist in ${dataSource.options.migrationsTableName ?? 'the migrations table'}. Run "npm run migration:run".`,
      );
      return 1;
    }

    logger.log(`Schema is current: ${dataSource.migrations.length} migration(s), none pending.`);
    return 0;
  } catch (error) {
    logger.error(
      `Database check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
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
