import { extname, resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { buildSharedDatabaseOptions } from '../database.config';

/**
 * Standalone DataSource for the TypeORM CLI. Referenced verbatim by the `migration:*`
 * scripts in `backend/package.json`:
 *
 *   -d libs/database/src/data-sources/api.data-source.ts
 *
 * It reads the **same** environment as the running API (`backend/.env`) through the same
 * builder, so `synchronize: false`, the camelCase naming strategy, SSL and the
 * `api_migrations` tracking table cannot drift between the CLI and the process.
 *
 * The CLI runs outside Nest, so `@nestjs/config` has not loaded `.env` yet — dotenv does it
 * here. `DATABASE_URL` still has no fallback: an unset variable throws.
 */
loadDotenv();

/**
 * Resolves the monorepo root relative to this file so the globs work from both layouts:
 *
 *   ts-node:  backend/libs/database/src/data-sources/api.data-source.ts  -> backend/
 *   compiled: backend/dist/libs/database/src/data-sources/api.data-source.js -> backend/dist/
 *
 * Four levels up in either case, because `tsc` mirrors the source tree under `dist/`.
 */
const rootDir = resolve(__dirname, '..', '..', '..', '..');

/** `.ts` under ts-node, `.js` under `dist/`. Getting this wrong silently loads no migrations. */
const sourceExtension = extname(__filename) === '.js' ? 'js' : 'ts';

/** TypeORM matches globs with forward slashes only; Windows paths must be normalised. */
function glob(...segments: string[]): string {
  return resolve(rootDir, ...segments).replace(/\\/g, '/');
}

/**
 * Entity globs are fixed by ARCHITECTURE.md §1.1. Feature modules keep entities under
 * `modules/{feature}/entities/`; the handful with no single owning module live in
 * `shared/entities/`.
 */
export const apiDataSourceOptions: DataSourceOptions = {
  ...buildSharedDatabaseOptions((key) => process.env[key]),

  entities: [
    glob('apps', 'api', 'src', 'modules', '**', 'entities', `*.entity.${sourceExtension}`),
    glob('apps', 'api', 'src', 'shared', 'entities', `*.entity.${sourceExtension}`),
  ],

  migrations: [glob('libs', 'database', 'src', 'migrations', 'api', `*.${sourceExtension}`)],

  // Belt and braces: the CLI must never be the thing that changes a schema implicitly.
  synchronize: false,
  migrationsRun: false,
  dropSchema: false,
};

/**
 * Default export is what `typeorm -d <file>` picks up. Also exported by name so the
 * `db-check` / `db-reset` scripts can reuse the identical configuration.
 */
export const apiDataSource = new DataSource(apiDataSourceOptions);

export default apiDataSource;
