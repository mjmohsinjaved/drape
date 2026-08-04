/**
 * `@library/database` — the public surface of the database library.
 *
 * Import rule (ARCHITECTURE.md §1.1): always import from this barrel —
 * `import { BaseEntity, runInTransaction } from '@library/database'` — never from a file
 * path inside the library.
 *
 * Two things are deliberately **not** re-exported here:
 *
 * - `data-sources/api.data-source` — constructing it loads `.env` through dotenv and builds a
 *   second DataSource. That is correct for the TypeORM CLI and wrong for the running API,
 *   which gets its connection from `DatabaseModule`. The migration scripts reference the file
 *   path directly.
 * - `scripts/*` — those are executables. Importing one runs it.
 */

// Base entities (§2.1) — every entity extends exactly one of these.
export { BaseEntity } from './entities/base.entity';
export { AppendOnlyEntity } from './entities/append-only.entity';

// Money (§2.1) — every decimal(18,2) column declares one of these transformers.
export {
  DECIMAL_PRECISION,
  DECIMAL_SCALE,
  decimalTransformer,
  nullableDecimalTransformer,
} from './transformers/decimal.transformer';

// Connection.
export { DatabaseModule } from './database.module';
export { DatabaseConnectionService, type DatabaseHealth } from './database-connection.service';
export {
  API_MIGRATIONS_TABLE,
  buildSharedDatabaseOptions,
  type EnvReader,
  type SharedDatabaseOptions,
} from './database.config';
export { CamelCaseNamingStrategy } from './naming/camel-case-naming.strategy';

// Transactions (§2.9 rule 3) — the only sanctioned way to span two writes.
export { runInTransaction, type RunInTransactionOptions } from './transaction/transaction.helper';

// Pagination (§2.8) — the only shape a list endpoint returns.
export { paginate, type PaginateOptions } from './repository/paginate';
