import { Logger } from '@nestjs/common';

import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

const logger = new Logger('Transaction');

/** Options for {@link runInTransaction}. */
export interface RunInTransactionOptions {
  /**
   * PostgreSQL isolation level. Omit for the server default (`READ COMMITTED`).
   * Use `SERIALIZABLE` only where a read-then-write race actually matters — deriving a quota
   * balance with `SUM(delta)` and then appending the consuming row, for instance (§4.0/10).
   */
  readonly isolationLevel?: IsolationLevel;
  /** Label used in the rollback log line. Defaults to the caller being anonymous. */
  readonly label?: string;
}

/**
 * Runs `work` inside a single database transaction and hands it the transactional
 * `EntityManager`.
 *
 * ARCHITECTURE.md §2.9 rule 3: "Any method writing to two or more tables runs inside a
 * `QueryRunner` transaction; events are emitted **after** `commitTransaction()`." This is the
 * only implementation of that. Services must never hand-roll connect/start/commit/rollback —
 * the failure mode of a forgotten `release()` is a leaked pool connection, and a pool of ten
 * leaks itself to death in an afternoon.
 *
 * Guarantees:
 * - the query runner is **always** released, including when `work` throws and including when
 *   the rollback itself throws;
 * - the original error is what propagates — a failing rollback is logged, never rethrown in
 *   place of the cause;
 * - nothing is committed if `work` rejects.
 *
 * Emit domain events from the caller *after* this resolves, never from inside `work`: a
 * listener that fires on a transaction that later rolls back has told the world a lie.
 *
 * @example
 * const enquiry = await runInTransaction(this.dataSource, async (manager) => {
 *   const saved = await manager.save(Enquiry, draft);
 *   await manager.insert(EnquiryItem, itemsFor(saved));
 *   return saved;
 * });
 * this.events.emit('enquiry.created', enquiry.id);
 */
export async function runInTransaction<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
  options: RunInTransactionOptions = {},
): Promise<T> {
  const queryRunner: QueryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  await (options.isolationLevel === undefined
    ? queryRunner.startTransaction()
    : queryRunner.startTransaction(options.isolationLevel));

  try {
    const result = await work(queryRunner.manager);
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    await rollbackQuietly(queryRunner, options.label, error);
    throw error;
  } finally {
    await queryRunner.release();
  }
}

/**
 * Rolls back without ever replacing the caller's error. A rollback failure (connection
 * already dropped, for example) is a symptom; the original throw is the diagnosis.
 */
async function rollbackQuietly(
  queryRunner: QueryRunner,
  label: string | undefined,
  cause: unknown,
): Promise<void> {
  const scope = label === undefined ? 'transaction' : `transaction "${label}"`;

  try {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
      logger.warn(`Rolled back ${scope}: ${describe(cause)}`);
    }
  } catch (rollbackError) {
    logger.error(`Rollback of ${scope} failed: ${describe(rollbackError)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
