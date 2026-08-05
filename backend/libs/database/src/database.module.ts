import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';

import { DatabaseConnectionService } from './database-connection.service';
import { buildSharedDatabaseOptions } from './database.config';

/**
 * Reads one setting as the string `EnvReader` is documented to take.
 *
 * `ConfigModule.forRoot({ validate })` stores the **validated** object, not the raw
 * strings: `validateEnv` coerces `DATABASE_POOL_MAX` to a `number` and `DATABASE_SSL`
 * to a `boolean`, and `ConfigService.get` hands those back. Passing them straight
 * into `buildSharedDatabaseOptions` — whose parsers are string parsers — made the
 * factory throw `value.trim is not a function` before the pool was ever built, which
 * is to say the API could not start at all. The API's environment and the TypeORM
 * CLI's `process.env` must reach the shared builder in the same shape; this is the
 * one place that knows both sides, so the normalisation belongs here.
 */
function readAsString(config: ConfigService, key: string): string | undefined {
  const value = config.get<unknown>(key);

  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  // `undefined`, `null`, or something that is not a §7 scalar at all. Absent is the
  // honest answer: `buildSharedDatabaseOptions` then applies its documented default,
  // or throws for `DATABASE_URL`, which is what E-2 asks of a missing credential.
  return undefined;
}

/**
 * The one place the API opens a database connection (B-3: the API is the only process with
 * database credentials).
 *
 * Everything that could be got wrong here is got right in exactly one place:
 * - `synchronize` is hardcoded `false` and is never read from the environment (§0).
 * - `migrationsRun` is `false`; migrations are an operator step, reviewed and reversible (E-3).
 * - `autoLoadEntities` picks up whatever `TypeOrmModule.forFeature([...])` registered, so no
 *   entity glob has to be maintained for the runtime process.
 * - The naming strategy preserves camelCase column names (§2.2).
 * - Pool size, SSL and log level come from the environment; the connection URL is required
 *   and has no fallback (§7, E-2).
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => ({
        ...buildSharedDatabaseOptions((key) => readAsString(configService, key)),

        // Re-asserted after the spread so that no future edit to the shared builder — and no
        // environment variable, ever — can turn schema sync on. §0: "no exceptions".
        synchronize: false,
        migrationsRun: false,
        dropSchema: false,

        // Entities are contributed by the feature modules through
        // `TypeOrmModule.forFeature([...])`; §2.9 rule 5 keeps modules from reaching
        // across into one another's entity files.
        autoLoadEntities: true,

        // The runtime process never runs or even loads migrations. `npm run migration:run`
        // uses libs/database/src/data-sources/api.data-source.ts instead.
        migrations: [],

        // Refuse to limp along on a database that is not answering: fail the boot instead.
        retryAttempts: 3,
        retryDelay: 2_000,
        verboseRetryLog: false,
      }),
    }),
  ],
  providers: [DatabaseConnectionService],
  exports: [DatabaseConnectionService],
})
export class DatabaseModule {}
