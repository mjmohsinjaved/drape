import { createInMemoryRepository, type InMemoryRepository } from '../../../../test/fixtures';
import { SERIALIZATION_FAILURE } from '../utils/postgres-errors';

import type { DataSource, EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * Test doubles for the two append-only ledgers.
 *
 * The shared `apps/api/test/fixtures` repository is deliberately partial — it says so
 * itself — and two of the things it leaves out are exactly the two this module lives
 * on: `sum()`, and a `QueryRunner` with an isolation level. Rather than stub them per
 * test (which would mean the arithmetic tests were testing their own stubs), the gaps
 * are filled here, once, in the module that needs them.
 *
 * Nothing here opens a connection, reads a file or binds a port.
 */

/**
 * An in-memory repository that can `sum()`.
 *
 * `sum` is implemented by delegating to the shared fixture's `find()`, so it honours
 * the same `where` semantics — including `In`, `MoreThanOrEqual` and the rest — rather
 * than re-implementing operator matching and drifting from it. A service that derives
 * a balance through this fixture is exercising its real query shape, and a test that
 * seeds a grant and two consumptions gets `SUM(delta)` for real.
 */
export function createLedgerRepository<T extends ObjectLiteral & { id: string }>(
  rows: readonly T[] = [],
): InMemoryRepository<T> {
  const repository = createInMemoryRepository<T>({ rows });

  const sum = jest.fn(async (column: keyof T, where?: unknown): Promise<number | null> => {
    const matched = await repository.find(
      where === undefined ? {} : ({ where } as Parameters<typeof repository.find>[0]),
    );
    if (matched.length === 0) {
      // TypeORM returns null for an empty aggregate; the service COALESCEs it to 0,
      // and this fixture must reproduce that or the coalescing would go untested.
      return null;
    }
    return matched.reduce((total, row) => total + Number(row[column] ?? 0), 0);
  });

  // The fixture's proxy only traps `get`, so this lands on the underlying object.
  // `jest.fn` so a test can assert *how many* scans a code path costs, which is the whole
  // point of folding the aggregates into one query (PRD §9.1).
  const createQueryBuilder = jest.fn(periodTotalsQueryBuilder(repository));

  Object.assign(repository, { sum, createQueryBuilder });

  return repository;
}

/** One grouped row, exactly as `getRawMany()` hands it back. */
interface PeriodTotalsRow {
  reason: string;
  delta: number;
  trailingDelta: number;
}

/**
 * A query-builder double for the **one** aggregate shape `BudgetService` builds:
 *
 * ```sql
 * SELECT reason, SUM(delta), SUM(delta) FILTER (WHERE "createdAt" >= :since)
 * FROM usage_ledger WHERE period = :period GROUP BY reason
 * ```
 *
 * The shared fixture refuses `createQueryBuilder()` on purpose — emulating one in general would
 * give a test false confidence about ownership and visibility predicates, which is where the
 * S-10 and §9.2 rules live. This is not a general emulation: it answers that single shape, from
 * the `:period` and `:since` **parameters** rather than by parsing SQL, and throws if a caller
 * builds anything else. The predicate it stands in for is `period = :period` and nothing more,
 * so there is no authorisation logic here to get wrong.
 *
 * Written here rather than in `apps/api/test/fixtures` for the same reason `sum` is: this is the
 * module whose services depend on it.
 */
function periodTotalsQueryBuilder<T extends ObjectLiteral & { id: string }>(
  repository: InMemoryRepository<T>,
): () => SelectQueryBuilder<T> {
  return (): SelectQueryBuilder<T> => {
    let grouped = false;
    const parameters: Record<string, unknown> = {};

    const builder = {
      select: (): unknown => builder,
      addSelect: (): unknown => builder,
      where: (_condition: string, params?: Record<string, unknown>): unknown => {
        Object.assign(parameters, params ?? {});
        return builder;
      },
      andWhere: (_condition: string, params?: Record<string, unknown>): unknown => {
        Object.assign(parameters, params ?? {});
        return builder;
      },
      groupBy: (): unknown => {
        grouped = true;
        return builder;
      },
      getRawMany: (): Promise<PeriodTotalsRow[]> => {
        if (!grouped || typeof parameters.period !== 'string') {
          throw new Error(
            'The ledger query-builder fixture only answers "SUM(delta) GROUP BY reason" for a ' +
              'single :period. Extend it deliberately if a second shape is introduced.',
          );
        }

        const since = parameters.since instanceof Date ? parameters.since : null;
        const totals = new Map<string, PeriodTotalsRow>();

        for (const row of repository.$rows) {
          if (row.period !== parameters.period || row.deletedAt != null) {
            continue;
          }
          const reason = String(row.reason);
          const current = totals.get(reason) ?? { reason, delta: 0, trailingDelta: 0 };
          const delta = Number(row.delta ?? 0);
          const createdAt: unknown = row.createdAt;
          const inWindow =
            since !== null && createdAt instanceof Date && createdAt.getTime() >= since.getTime();

          totals.set(reason, {
            reason,
            delta: current.delta + delta,
            trailingDelta: current.trailingDelta + (inWindow ? delta : 0),
          });
        }

        return Promise.resolve([...totals.values()]);
      },
    };

    return builder as unknown as SelectQueryBuilder<T>;
  };
}

/** Live counters, so a test can assert "one transaction", not "probably a transaction". */
export interface TransactionState {
  started: number;
  committed: number;
  rolledBack: number;
  released: number;
  /** Every isolation level requested, in order. */
  isolationLevels: (string | undefined)[];
}

export interface FakeTransactionalDataSourceOptions {
  /** Entity class → the repository the transactional manager should hand back. */
  readonly repositories: ReadonlyMap<unknown, unknown>;
  /**
   * Serialise transactions, as row and predicate locks do under a real
   * `SERIALIZABLE`. With this on, two concurrent callers cannot interleave their
   * read-then-write, which is the property `SERIALIZABLE` buys and the property the
   * concurrency specs are written to prove.
   */
  readonly serialise?: boolean;
  /**
   * Abort the *n*th transaction with a PostgreSQL `40001` at commit time. Used to
   * prove the single retry actually happens and that a serialization failure is not
   * mistaken for a business error.
   *
   * Injected at `commitTransaction` rather than at `startTransaction` because that is
   * where PostgreSQL raises it, and because `runInTransaction` starts the transaction
   * *outside* its `try` — a throw from `startTransaction` would skip the rollback and
   * the `release()`, which is neither what the database does nor what the helper is
   * being tested against.
   */
  readonly failWithSerializationErrorOnAttempt?: number;
}

export interface FakeTransactionalDataSource {
  readonly dataSource: DataSource;
  readonly transactions: TransactionState;
}

/**
 * A `DataSource` double shaped for `runInTransaction`.
 *
 * `runInTransaction` drives a `QueryRunner` — `connect`, `startTransaction(level)`,
 * `manager`, `commitTransaction`, `release` — rather than `DataSource.transaction()`,
 * so a `transaction()`-shaped double would never be called and every "is it
 * transactional?" assertion would silently pass. This one implements the interface the
 * helper actually uses, records the isolation level it was given, and optionally
 * serialises concurrent callers.
 */
export function createFakeTransactionalDataSource(
  options: FakeTransactionalDataSourceOptions,
): FakeTransactionalDataSource {
  const transactions: TransactionState = {
    started: 0,
    committed: 0,
    rolledBack: 0,
    released: 0,
    isolationLevels: [],
  };

  const manager = {
    getRepository: (entity: unknown): unknown => {
      const repository = options.repositories.get(entity);
      if (repository === undefined) {
        const name = typeof entity === 'function' ? entity.name : String(entity);
        throw new Error(`No ledger fixture registered for ${name}.`);
      }
      return repository;
    },
  } as unknown as EntityManager;

  /** The tail of the serialisation chain: each transaction waits for the previous one. */
  let chain: Promise<void> = Promise.resolve();

  const createQueryRunner = (): unknown => {
    let active = false;
    let attempt = 0;
    let releaseLock: (() => void) | null = null;

    return {
      manager,
      get isTransactionActive(): boolean {
        return active;
      },
      connect: async (): Promise<void> => Promise.resolve(),
      startTransaction: async (isolationLevel?: string): Promise<void> => {
        if (options.serialise === true) {
          const previous = chain;
          chain = new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          await previous;
        }

        transactions.started += 1;
        transactions.isolationLevels.push(isolationLevel);
        attempt = transactions.started;
        active = true;
      },
      // Not `async`: there is nothing to await, and an `async` body with no `await`
      // is exactly what `@typescript-eslint/require-await` exists to catch. The
      // `Promise<void>` return is what `runInTransaction` needs, and it gets it.
      commitTransaction: (): Promise<void> => {
        if (options.failWithSerializationErrorOnAttempt === attempt) {
          return Promise.reject(serializationFailure());
        }
        transactions.committed += 1;
        active = false;
        return Promise.resolve();
      },
      rollbackTransaction: (): Promise<void> => {
        transactions.rolledBack += 1;
        active = false;
        return Promise.resolve();
      },
      release: (): Promise<void> => {
        transactions.released += 1;
        releaseLock?.();
        releaseLock = null;
        return Promise.resolve();
      },
    };
  };

  return {
    dataSource: { createQueryRunner } as unknown as DataSource,
    transactions,
  };
}

/** A PostgreSQL serialization failure, shaped the way `pg` reports one. */
export function serializationFailure(): Error & { code: string } {
  return Object.assign(
    new Error('could not serialize access due to read/write dependencies among transactions'),
    { code: SERIALIZATION_FAILURE },
  );
}
