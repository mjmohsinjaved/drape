import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { DataSource } from 'typeorm';

import { ApiModule } from '@api/api.module';

import { adminSeeder } from './admin.seeder';
import { categoriesSeeder } from './categories.seeder';
import { policyVersionSeeder } from './policy-version.seeder';
import { referenceModelsSeeder } from './reference-models.seeder';
import { settingsSeeder } from './settings.seeder';

import type { SeedContext, SeedOutcome, Seeder } from './seeder.contract';

/**
 * `npm run seed` — brings a freshly migrated database up to a usable starting state
 * (PRD E-4).
 *
 * This is a CLI, so it writes to stdout on purpose, through the Nest `Logger` rather than
 * `console` (CLAUDE.md).
 *
 * Design notes:
 *
 *  - It boots the real application context (`ApiModule`) rather than opening its own
 *    connection. That means the seeders use the same `DataSource`, the same entity
 *    metadata and the same configured `StorageService` the API uses — there is no second
 *    definition of "where things go" to drift out of sync.
 *  - Every seeder runs inside its own transaction. One failing seeder rolls itself back
 *    and aborts the run with a non-zero exit code; the seeders that already succeeded stay
 *    committed, and re-running picks up where it left off because they are all idempotent.
 *  - Files written to `STORAGE_ROOT` are NOT transactional. If `reference-models` writes
 *    its images and then the insert fails, the objects are left behind with no owning row
 *    and are swept by the retention cron (§3.5 step 4).
 *
 * Run order matters only in that `settings` should exist before anything reads a
 * configured default. None of these seeders has a foreign key on another.
 */
const SEEDERS: readonly Seeder[] = [
  settingsSeeder,
  adminSeeder,
  policyVersionSeeder,
  categoriesSeeder,
  referenceModelsSeeder,
];

interface SeedReport {
  readonly name: string;
  readonly outcome: SeedOutcome;
  readonly durationMs: number;
}

export async function runSeed(): Promise<void> {
  const logger = new Logger('seed');
  const startedAt = Date.now();

  // `error`/`warn` only from the framework: booting the whole application to run a seed is
  // noisy otherwise, and the useful output is the summary below.
  const app = await NestFactory.createApplicationContext(ApiModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });

  try {
    const dataSource = app.get(DataSource);
    const now = new Date();
    const reports: SeedReport[] = [];

    logger.log(
      `Seeding "${dataSource.options.database?.toString() ?? 'database'}" — ${SEEDERS.length} seeders.`,
    );

    for (const seeder of SEEDERS) {
      const seederStartedAt = Date.now();
      try {
        const outcome = await dataSource.transaction(async (manager): Promise<SeedOutcome> =>
          seeder.run({ app, manager, dataSource, env: process.env, now } satisfies SeedContext),
        );
        reports.push({ name: seeder.name, outcome, durationMs: Date.now() - seederStartedAt });
      } catch (error) {
        logger.error(`Seeder "${seeder.name}" failed. Nothing it wrote has been committed.`);
        throw error;
      }
    }

    printSummary(logger, reports, Date.now() - startedAt);
  } finally {
    await app.close();
  }
}

function printSummary(logger: Logger, reports: readonly SeedReport[], totalMs: number): void {
  const nameWidth = Math.max(...reports.map((report) => report.name.length), 'seeder'.length);
  const pad = (value: string): string => value.padEnd(nameWidth, ' ');

  logger.log('');
  logger.log(`${pad('seeder')}   created   skipped   time`);
  logger.log('-'.repeat(nameWidth + 28));

  let created = 0;
  let skipped = 0;
  for (const report of reports) {
    created += report.outcome.created;
    skipped += report.outcome.skipped;
    logger.log(
      `${pad(report.name)}   ${String(report.outcome.created).padStart(7)}   ` +
        `${String(report.outcome.skipped).padStart(7)}   ${report.durationMs}ms`,
    );
  }

  logger.log('-'.repeat(nameWidth + 28));
  logger.log(
    `${pad('total')}   ${String(created).padStart(7)}   ${String(skipped).padStart(7)}   ${totalMs}ms`,
  );

  const notes = reports.flatMap((report) =>
    (report.outcome.notes ?? []).map((note) => `[${report.name}] ${note}`),
  );
  if (notes.length > 0) {
    logger.log('');
    for (const note of notes) {
      logger.log(note);
    }
  }

  logger.log('');
  logger.log('Seed complete. Verify with:');
  logger.log('  ts-node -r tsconfig-paths/register scripts/db-seed-check.ts');
}

if (require.main === module) {
  void runSeed().catch((error: unknown) => {
    const logger = new Logger('seed');
    logger.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack !== undefined) {
      logger.debug(error.stack);
    }
    process.exitCode = 1;
  });
}
