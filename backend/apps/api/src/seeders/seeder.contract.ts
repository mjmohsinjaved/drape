import type { INestApplicationContext } from '@nestjs/common';

import type { DataSource, EntityManager } from 'typeorm';

/**
 * Shared contract for every seeder in this folder.
 *
 * Rules that apply to all of them, without exception:
 *
 *  1. **Idempotent.** `npm run seed` may be run any number of times against the same
 *     database. A seeder inserts only what is missing and never duplicates a row. It
 *     also never *overwrites* a value an operator has since changed — the seed
 *     establishes a starting point, it does not enforce one.
 *  2. **Fail loudly.** A seeder that cannot do its job throws. `run-seed.ts` aborts the
 *     whole run with a non-zero exit code. Silently skipping is never correct.
 *  3. **No hardcoded credentials.** Anything secret comes from the environment and has
 *     no fallback (PRD E-2, S-5). See `admin.seeder.ts`.
 *  4. **One transaction per seeder**, opened by the orchestrator. A seeder that throws
 *     rolls back cleanly and leaves nothing half-written.
 */
export interface SeedContext {
  /** The booted Nest application context — use it to resolve services such as `StorageService`. */
  readonly app: INestApplicationContext;
  /**
   * Transaction-scoped manager. **Every read and write a seeder performs goes through this**,
   * so a seeder that throws rolls back cleanly. One transaction per seeder, opened by
   * `run-seed.ts`.
   */
  readonly manager: EntityManager;
  /**
   * The application's single TypeORM `DataSource`. Resolved from the container, never opened
   * twice. Present for metadata inspection only — write through `manager`.
   */
  readonly dataSource: DataSource;
  /** Process environment, passed explicitly so seeders stay testable. */
  readonly env: NodeJS.ProcessEnv;
  /** One timestamp for the entire run, so rows seeded together share it. */
  readonly now: Date;
}

/** What a seeder reports back to the orchestrator for the run summary. */
export interface SeedOutcome {
  /** Rows inserted by this run. */
  readonly created: number;
  /** Rows that already existed and were deliberately left alone. */
  readonly skipped: number;
  /** Human-readable lines printed under the summary (e.g. "replace before production"). */
  readonly notes?: readonly string[];
}

export interface Seeder {
  /** Stable identifier used in the run summary and by `scripts/db-seed-check.ts`. */
  readonly name: string;
  run(context: SeedContext): Promise<SeedOutcome>;
}

/**
 * Reads a required seed variable.
 *
 * @throws Error naming the variable and why there is no default. This is the mechanism
 *   that stops a hardcoded first-admin account ever existing (PRD E-4, E-2, S-5).
 */
export function requireSeedEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value === '') {
    throw new Error(
      `${key} is not set. The seeder refuses to invent one — a credential never has a fallback ` +
        `default (docs/ARCHITECTURE.md §7, PRD E-2). Set it in backend/.env; see .env.example.`,
    );
  }
  return value;
}

/** Reads an optional integer setting. Tuning values may have defaults; credentials may not. */
export function readSeedInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${key} must be an integer, received "${raw}".`);
  }
  return parsed;
}
