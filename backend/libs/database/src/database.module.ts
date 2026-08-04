import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';

import { DatabaseConnectionService } from './database-connection.service';
import { buildSharedDatabaseOptions } from './database.config';

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
        ...buildSharedDatabaseOptions((key) => configService.get<string>(key)),

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
