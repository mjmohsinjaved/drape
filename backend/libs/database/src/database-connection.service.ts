import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { DataSource } from 'typeorm';

/** What `/health/ready` reports about the database (ARCHITECTURE.md §5.21). */
export interface DatabaseHealth {
  /** `true` only when a round trip to PostgreSQL succeeded just now. */
  readonly connected: boolean;
  /** Database name, taken from the connection URL. Never the URL itself. */
  readonly database: string | null;
  /** Host and port, taken from the connection URL. Credentials are never included. */
  readonly host: string | null;
  /** Round-trip latency of the probe, in milliseconds. */
  readonly latencyMs: number;
  /** Present only when the probe failed. Safe to surface — no credentials, no query text. */
  readonly error?: string;
}

/**
 * Owns nothing about the schema; owns everything about "is the database actually there".
 *
 * Fails fast on boot (a Drape API with no database can serve no route worth serving) and
 * exposes {@link isHealthy} / {@link check} for the health module.
 *
 * Lifecycle note: this service deliberately does **not** destroy the DataSource on shutdown.
 * `TypeOrmModule.forRootAsync` created it and `TypeOrmCoreModule` closes it during Nest's
 * shutdown hooks; destroying it here as well races that and logs a spurious error.
 */
@Injectable()
export class DatabaseConnectionService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseConnectionService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    const health = await this.check();
    if (!health.connected) {
      this.logger.error(
        `Database connection failed for ${health.database ?? 'unknown'}@${health.host ?? 'unknown'}: ${health.error ?? 'unknown error'}`,
      );
      // Fail fast — do not start the API without a database.
      throw new Error('Database connection failed during startup');
    }

    this.logger.log(
      `Database connected: ${health.database ?? 'unknown'}@${health.host ?? 'unknown'} (${health.latencyMs}ms)`,
    );
  }

  /**
   * Cheap liveness probe used by `/health/ready`. Never throws — a health endpoint that
   * throws is a health endpoint that lies.
   */
  async isHealthy(): Promise<boolean> {
    const health = await this.check();
    return health.connected;
  }

  /** Full probe result: connectivity, target and latency, with credentials stripped. */
  async check(): Promise<DatabaseHealth> {
    const target = describeTarget(this.dataSource);
    const startedAt = Date.now();

    if (!this.dataSource.isInitialized) {
      return {
        connected: false,
        database: target.database,
        host: target.host,
        latencyMs: 0,
        error: 'DataSource is not initialized',
      };
    }

    try {
      await this.dataSource.query('SELECT 1');
      return {
        connected: true,
        database: target.database,
        host: target.host,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        connected: false,
        database: target.database,
        host: target.host,
        latencyMs: Date.now() - startedAt,
        error: toMessage(error),
      };
    }
  }

  /** `true` when the pool has been opened. Does not prove the server is answering. */
  get isInitialized(): boolean {
    return this.dataSource.isInitialized;
  }
}

/**
 * Extracts host and database from the connection options **without** ever touching the
 * password. `DATABASE_URL` contains a credential and must never reach a log line (B-3).
 */
function describeTarget(dataSource: DataSource): {
  host: string | null;
  database: string | null;
} {
  const options = dataSource.options as {
    url?: string;
    host?: string;
    port?: number;
    database?: string;
  };

  if (typeof options.url === 'string' && options.url !== '') {
    try {
      const parsed = new URL(options.url);
      return {
        host: parsed.port === '' ? parsed.hostname : `${parsed.hostname}:${parsed.port}`,
        database: parsed.pathname.replace(/^\//, '') || null,
      };
    } catch {
      // A malformed URL is a boot-time problem reported elsewhere; never echo it back.
      return { host: null, database: null };
    }
  }

  return {
    host: options.host === undefined ? null : `${options.host}:${options.port ?? 5432}`,
    database: options.database ?? null,
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
