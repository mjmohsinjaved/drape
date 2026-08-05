import { CamelCaseNamingStrategy } from './naming/camel-case-naming.strategy';

import type { LoggerOptions } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

/**
 * The single place database connection options are derived, so the Nest module
 * (`TypeOrmModule.forRootAsync`, values from `ConfigService`) and the TypeORM CLI DataSource
 * (values from `process.env`) can never drift apart.
 *
 * ARCHITECTURE.md §0: "Migrations only. `synchronize: false` in every environment, no
 * exceptions." §7: no credential has a fallback default in code (E-2) — a missing
 * `DATABASE_URL` throws here rather than quietly connecting to something.
 */

/** Reads one environment value. `ConfigService.get` and `process.env` both satisfy this. */
export type EnvReader = (key: string) => string | undefined;

/** Migration tracking table for the one deployable app (ARCHITECTURE.md §1.1). */
export const API_MIGRATIONS_TABLE = 'api_migrations';

/** Options every consumer shares. Entities and migrations are supplied by the caller. */
export type SharedDatabaseOptions = Omit<
  PostgresConnectionOptions,
  'entities' | 'migrations' | 'autoLoadEntities'
>;

interface PoolSettings {
  readonly max: number;
  readonly min: number;
  readonly idleTimeoutMillis: number;
  readonly connectionTimeoutMillis: number;
}

/**
 * Builds the options shared by the runtime connection and the CLI DataSource.
 *
 * @throws Error when `DATABASE_URL` is absent. Boot must fail, not a request.
 */
export function buildSharedDatabaseOptions(env: EnvReader): SharedDatabaseOptions {
  const url = requireEnv(env, 'DATABASE_URL');
  const nodeEnv = env('NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';
  const pool = resolvePool(env, isProduction);

  return {
    type: 'postgres',
    url,

    // §0: never true, in any environment, and never read from an environment variable.
    synchronize: false,

    // Migrations are an explicit, reviewed, operator-run step (PRD E-3). The API never
    // mutates the schema on boot.
    migrationsRun: false,
    migrationsTableName: API_MIGRATIONS_TABLE,

    // §2.2: columns stay camelCase. See CamelCaseNamingStrategy for why this is pinned.
    namingStrategy: new CamelCaseNamingStrategy(),

    logging: resolveLogging(env),
    logger: 'advanced-console',
    maxQueryExecutionTime: isProduction ? 2_000 : 5_000,

    ssl: resolveSsl(env),
    poolSize: pool.max,
    extra: {
      max: pool.max,
      min: pool.min,
      idleTimeoutMillis: pool.idleTimeoutMillis,
      connectionTimeoutMillis: pool.connectionTimeoutMillis,
      // Shows up in pg_stat_activity, so a runaway connection is attributable (E-17).
      application_name: 'drape-api',
    },

    // A restart storm must not take the API down permanently, but it must not mask a
    // genuinely unreachable database either.
    installExtensions: false,

    // UUID defaults are `gen_random_uuid()`, not `uuid_generate_v4()`. That function is
    // core PostgreSQL from 13 onwards, so it needs no extension — which matters because
    // `installExtensions` is false above and CREATE EXTENSION needs rights the API role
    // does not have. TypeORM's default is 'uuid-ossp'; without this line every generated
    // migration emits `uuid_generate_v4()` and fails on a database with no contrib
    // modules installed. 'pgcrypto' here selects the *spelling*, not an extension: nothing
    // is installed and nothing is required.
    uuidExtension: 'pgcrypto',
    applicationName: 'drape-api',
  };
}

/**
 * TLS to the database. `DATABASE_SSL=true` turns it on with certificate verification;
 * anything else leaves it off. There is deliberately no "verify nothing" mode — that would
 * make the setting theatre.
 */
function resolveSsl(env: EnvReader): PostgresConnectionOptions['ssl'] {
  return parseBoolean(env('DATABASE_SSL')) ? { rejectUnauthorized: true } : false;
}

/**
 * Pool ceiling and floor. §7 documents 10/2 for development and 20–50 for production; the
 * defaults below match, and both are overridable. These are tuning values, not credentials,
 * so defaults are allowed.
 */
function resolvePool(env: EnvReader, isProduction: boolean): PoolSettings {
  const max = parseInteger(env('DATABASE_POOL_MAX'), isProduction ? 20 : 10);
  const min = Math.min(parseInteger(env('DATABASE_POOL_MIN'), isProduction ? 5 : 2), max);

  return {
    max,
    min,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: isProduction ? 5_000 : 10_000,
  };
}

/**
 * Maps `LOG_LEVEL` (§7: `debug | info | warn | error`) onto TypeORM's logger categories.
 * Query logging is a `debug`-only privilege — query text can carry personal data.
 */
function resolveLogging(env: EnvReader): LoggerOptions {
  switch ((env('LOG_LEVEL') ?? 'info').toLowerCase()) {
    case 'debug':
      return ['query', 'error', 'warn', 'schema', 'migration'];
    case 'info':
      return ['error', 'warn', 'schema', 'migration'];
    case 'warn':
      return ['error', 'warn'];
    case 'error':
      return ['error'];
    default:
      return ['error', 'warn'];
  }
}

function requireEnv(env: EnvReader, key: string): string {
  const value = env(key)?.trim();
  if (value === undefined || value === '') {
    throw new Error(
      `${key} is not set. The API refuses to start without it — there is no fallback default for a credential (ARCHITECTURE.md §7, E-2).`,
    );
  }
  return value;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
