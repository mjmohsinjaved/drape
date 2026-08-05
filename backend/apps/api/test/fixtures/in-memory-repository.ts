import { randomUUID } from 'node:crypto';

import { FindOperator } from 'typeorm';

import type {
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  FindOptionsOrder,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';

/**
 * An in-memory stand-in for a TypeORM `Repository`.
 *
 * There is no PostgreSQL on the machine this suite runs on (CLAUDE.md), so unit tests mock
 * the repository. A bag of `jest.fn()`s does that badly: every test has to re-teach the mock
 * what `findOne` means, and a test that forgot to stub one gets `undefined` back and passes
 * for entirely the wrong reason.
 *
 * This behaves like a repository instead. It stores rows, filters them, honours soft
 * deletes, and still records every call as a jest mock so `expect(repo.save).toHaveBeenCalled()`
 * works. A service that reads through it is exercised for real.
 *
 * **What it does not do**, deliberately:
 *  - `createQueryBuilder()` — throws with an explanation. Query-builder logic is where the
 *    ownership and visibility predicates live (S-10, §9.2), and pretending to emulate it
 *    would give a test false confidence about the one thing most worth verifying. Stub it
 *    explicitly, or cover it with an integration test.
 *  - Relations. `find({ relations: [...] })` returns the stored rows unchanged; wire the
 *    related objects into the fixture yourself.
 *  - Cascades, triggers and the append-only rules. Those are database behaviour and belong in a
 *    migration-backed test.
 *
 * **What it now does model, on request: partial unique indexes.** Pass `uniqueIndexes` and
 * `save`/`insert` raise a real `23505` the way PostgreSQL would. This is not decoration. A
 * whole class of defect lives in the code that *handles* a unique violation —
 * `TryOnRunnerService.openJob()` catches `23505` and turns it into the §8.4 idempotency
 * answer — and a double that never raises one leaves every branch of that handler
 * unreachable from a test. The `WHERE "deletedAt" IS NULL` predicate is honoured, because
 * releasing a key by soft-deleting the row it belongs to is exactly the manoeuvre the
 * predicate exists to permit (§4.0 rule 4).
 */

/** Extra handles for arranging and inspecting the fixture. Prefixed so they cannot clash. */
export interface InMemoryRepositoryControls<T> {
  /** Live view of the stored rows. Mutating it is fine — that is the point of a fixture. */
  readonly $rows: T[];
  /** Replaces the contents. */
  $seed(rows: readonly T[]): void;
  /** Empties the store and clears recorded calls. */
  $reset(): void;
}

export type InMemoryRepository<T extends ObjectLiteral> = Repository<T> &
  InMemoryRepositoryControls<T>;

/**
 * One partial unique index, as the migration declares it.
 *
 * ```ts
 * // CREATE UNIQUE INDEX "UQ_tryon_jobs_idem"
 * //   ON "tryon_jobs" ("userId", "idempotencyKey") WHERE "deletedAt" IS NULL
 * { name: 'UQ_tryon_jobs_idem', columns: ['userId', 'idempotencyKey'], whereNotSoftDeleted: true }
 * ```
 */
export interface UniqueIndexSpec<T> {
  /** The index name, so a violation says which constraint refused. */
  readonly name: string;
  readonly columns: readonly (keyof T & string)[];
  /**
   * `WHERE "deletedAt" IS NULL`. Defaults to `true` — §4.0 rule 4 requires it of every
   * unique index on a soft-deletable table, and CLAUDE.md restates it.
   */
  readonly whereNotSoftDeleted?: boolean;
  /**
   * `WHERE "<column>" IS NOT NULL`, for the append-only ledgers' `UQ_*_job` indexes. A row
   * whose value is null in any listed column is outside the index and never conflicts.
   */
  readonly whereNotNull?: readonly (keyof T & string)[];
}

export interface InMemoryRepositoryOptions<T> {
  /** Rows present before the test starts. */
  readonly rows?: readonly T[];
  /**
   * How `repository.create()` should build an instance. Pass the matching factory when the
   * code under test relies on `instanceof` or on decorator metadata; otherwise a shallow
   * clone is returned.
   */
  readonly create?: (input: Partial<T>) => T;
  /**
   * Partial unique indexes to enforce on `save()` and `insert()`, raising a
   * {@link UniqueViolationError} the way PostgreSQL raises `23505`.
   *
   * Declare the ones the code under test actually depends on. An index the service never
   * relies on costs a test nothing to omit, and one it *does* rely on is invisible without
   * this.
   */
  readonly uniqueIndexes?: readonly UniqueIndexSpec<T>[];
}

/** PostgreSQL `unique_violation`, in the shape TypeORM surfaces it. */
export class UniqueViolationError extends Error {
  readonly code = '23505';
  readonly driverError: { code: string; constraint: string };

  constructor(readonly constraint: string) {
    super(`duplicate key value violates unique constraint "${constraint}"`);
    this.name = 'QueryFailedError';
    this.driverError = { code: '23505', constraint };
  }
}

/** Methods that would mislead more than they help. Calling one fails with a reason. */
const UNSUPPORTED: ReadonlyMap<string, string> = new Map([
  [
    'createQueryBuilder',
    'The in-memory repository does not emulate the query builder. Ownership and visibility ' +
      'predicates live there — stub it explicitly with jest.fn(), or write an integration test.',
  ],
  ['query', 'Raw SQL cannot run against the in-memory repository.'],
  ['upsert', 'upsert() depends on a real unique index. Use save() plus an explicit lookup.'],
  ['increment', 'increment() is an atomic SQL update. Assert on the update() call instead.'],
  ['decrement', 'decrement() is an atomic SQL update. Assert on the update() call instead.'],
  ['restore', 'restore() is not implemented. Clear deletedAt on the fixture row directly.'],
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Applies one `FindOperator` (`In`, `IsNull`, `Not`, `LessThan`, `Like`, …) to a value.
 *
 * Operators nest — `Not(In([…]))` is a `not` wrapping an `in` — and TypeORM's `value`
 * getter **unwraps** to the innermost value, so reading `value` off a `Not(In([…]))` hands
 * back the bare array and loses the `in`. `child` is the nested operator, and honouring it
 * is the difference between `Not(In([…]))` excluding those rows and matching every row.
 */
function matchesOperator(operator: FindOperator<unknown>, actual: unknown): boolean {
  const { type, value, child } = operator;

  if (child !== undefined && type === 'not') {
    return !matchesOperator(child, actual);
  }

  switch (type) {
    case 'in':
      return Array.isArray(value) && value.some((candidate) => matchesValue(candidate, actual));
    case 'any':
      return Array.isArray(value) && value.some((candidate) => matchesValue(candidate, actual));
    case 'isNull':
      return actual === null || actual === undefined;
    case 'not':
      return !matchesValue(value, actual);
    case 'equal':
      return matchesValue(value, actual);
    case 'lessThan':
      return compare(actual, value) < 0;
    case 'lessThanOrEqual':
      return compare(actual, value) <= 0;
    case 'moreThan':
      return compare(actual, value) > 0;
    case 'moreThanOrEqual':
      return compare(actual, value) >= 0;
    case 'between': {
      const [low, high] = Array.isArray(value) ? value : [undefined, undefined];
      return compare(actual, low) >= 0 && compare(actual, high) <= 0;
    }
    case 'like':
    case 'ilike': {
      if (typeof actual !== 'string' || typeof value !== 'string') {
        return false;
      }
      const pattern = new RegExp(
        `^${value
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.')}$`,
        type === 'ilike' ? 'i' : '',
      );
      return pattern.test(actual);
    }
    default:
      throw new Error(`The in-memory repository does not implement the "${type}" find operator.`);
  }
}

function compare(left: unknown, right: unknown): number {
  const normalise = (value: unknown): number | string => {
    if (value instanceof Date) {
      return value.getTime();
    }
    return typeof value === 'number' || typeof value === 'string' ? value : String(value);
  };

  const a = normalise(left);
  const b = normalise(right);
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function matchesValue(expected: unknown, actual: unknown): boolean {
  if (expected instanceof FindOperator) {
    return matchesOperator(expected, actual);
  }
  if (expected instanceof Date && actual instanceof Date) {
    return expected.getTime() === actual.getTime();
  }
  return expected === actual;
}

function matchesWhere<T>(row: T, where: FindOptionsWhere<T>): boolean {
  const source = asRecord(row);

  return Object.entries(asRecord(where)).every(([key, expected]) => {
    const actual = source[key];

    // A nested object means a relation filter, e.g. { user: { id } }. Only the shallow case
    // is supported: the relation must already be present on the fixture row.
    if (
      expected !== null &&
      typeof expected === 'object' &&
      !(expected instanceof FindOperator) &&
      !(expected instanceof Date)
    ) {
      return actual !== null && typeof actual === 'object'
        ? matchesWhere(actual, expected as FindOptionsWhere<unknown>)
        : false;
    }

    return matchesValue(expected, actual);
  });
}

/** TypeORM treats an array of `where` clauses as OR. */
function matchesAnyWhere<T>(
  row: T,
  where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined,
): boolean {
  if (where === undefined) {
    return true;
  }
  return Array.isArray(where)
    ? where.some((clause) => matchesWhere(row, clause))
    : matchesWhere(row, where);
}

function isSoftDeleted(row: unknown): boolean {
  const value = asRecord(row).deletedAt;
  return value !== undefined && value !== null;
}

function applyOrder<T>(rows: T[], order: FindOptionsOrder<T> | undefined): T[] {
  if (order === undefined) {
    return rows;
  }

  const clauses = Object.entries(asRecord(order)).map(([key, direction]) => ({
    key,
    descending: String(direction).toUpperCase() === 'DESC',
  }));

  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      const result = compare(asRecord(left)[clause.key], asRecord(right)[clause.key]);
      if (result !== 0) {
        return clause.descending ? -result : result;
      }
    }
    return 0;
  });
}

/**
 * Creates a repository fixture.
 *
 * ```ts
 * const users = createInMemoryRepository<User>({ rows: [buildUser({ id: 'u1' })] });
 * await users.findOne({ where: { id: 'u1' } });      // the row
 * expect(users.findOne).toHaveBeenCalledTimes(1);    // still a jest mock
 * ```
 */
export function createInMemoryRepository<T extends ObjectLiteral & { id: string }>(
  options: InMemoryRepositoryOptions<T> = {},
): InMemoryRepository<T> {
  const rows: T[] = [...(options.rows ?? [])];

  const select = (findOptions?: FindManyOptions<T> | FindOneOptions<T>): T[] => {
    const withDeleted = findOptions?.withDeleted === true;
    const filtered = rows.filter(
      (row) => (withDeleted || !isSoftDeleted(row)) && matchesAnyWhere(row, findOptions?.where),
    );
    return applyOrder(filtered, findOptions?.order);
  };

  const paginate = (matched: T[], findOptions?: FindManyOptions<T>): T[] => {
    const skip = findOptions?.skip ?? 0;
    const take = findOptions?.take;
    return take === undefined ? matched.slice(skip) : matched.slice(skip, skip + take);
  };

  /**
   * PostgreSQL's answer to a duplicate, for whichever declared index the row collides with.
   *
   * A row is only *in* a partial index when it satisfies the index's predicate, so a
   * soft-deleted row conflicts with nothing — which is precisely what makes "soft-delete the
   * old row to release the idempotency key" a legal move rather than a hopeful one.
   */
  const assertNoUniqueViolation = (entity: T): void => {
    const indexes = options.uniqueIndexes ?? [];
    if (indexes.length === 0) {
      return;
    }

    const candidate = asRecord(entity);

    for (const index of indexes) {
      const applies = (row: T): boolean => {
        const source = asRecord(row);
        if (index.whereNotSoftDeleted !== false && isSoftDeleted(row)) {
          return false;
        }
        return (index.whereNotNull ?? []).every(
          (column) => source[column] !== null && source[column] !== undefined,
        );
      };

      if (!applies(entity)) {
        continue;
      }

      const collides = rows.some(
        (row) =>
          row.id !== entity.id &&
          applies(row) &&
          index.columns.every((column) => asRecord(row)[column] === candidate[column]),
      );

      if (collides) {
        throw new UniqueViolationError(index.name);
      }
    }
  };

  const upsertOne = (entity: T): T => {
    const target = asRecord(entity);
    if (typeof target.id !== 'string' || target.id === '') {
      target.id = randomUUID();
    }
    assertNoUniqueViolation(entity);
    // `BaseEntity.createdAt` is a `@CreateDateColumn`: PostgreSQL fills it on INSERT.
    // Emulated here because service code legitimately queries on it — the S-6 lockout
    // window reads `auth_attempts.createdAt`, and a row the ORM would have stamped but
    // this fixture left undefined silently drops out of every window predicate, which
    // makes a rate limit look like it works when the test never exercised it. Only set
    // when absent, so a row seeded with an explicit timestamp keeps it.
    target.createdAt ??= new Date();

    const index = rows.findIndex((row) => row.id === entity.id);
    if (index === -1) {
      rows.push(entity);
    } else {
      rows[index] = entity;
    }
    return entity;
  };

  const criteriaMatcher = (criteria: unknown): ((row: T) => boolean) => {
    if (typeof criteria === 'string') {
      return (row) => row.id === criteria;
    }
    if (Array.isArray(criteria)) {
      const ids = new Set(criteria.map((value) => String(value)));
      return (row) => ids.has(row.id);
    }
    return (row) => matchesAnyWhere(row, criteria as FindOptionsWhere<T>);
  };

  const controls: InMemoryRepositoryControls<T> = {
    get $rows(): T[] {
      return rows;
    },
    $seed(next: readonly T[]): void {
      rows.length = 0;
      rows.push(...next);
    },
    /** Empties the store. Recorded calls are cleared by `clearMocks` in jest.config.js. */
    $reset(): void {
      rows.length = 0;
    },
  };

  const implementation = {
    ...controls,

    create: jest.fn((input?: DeepPartial<T>): T => {
      const partial = (input ?? {}) as Partial<T>;
      return options.create ? options.create(partial) : ({ ...partial } as T);
    }),

    save: jest.fn(async (entity: T | T[]): Promise<T | T[]> =>
      Array.isArray(entity) ? entity.map(upsertOne) : upsertOne(entity),
    ),

    insert: jest.fn(async (entity: T | T[]) => {
      const saved = Array.isArray(entity) ? entity.map(upsertOne) : [upsertOne(entity)];
      return {
        identifiers: saved.map((row) => ({ id: row.id })),
        generatedMaps: saved,
        raw: saved,
      };
    }),

    find: jest.fn(async (findOptions?: FindManyOptions<T>): Promise<T[]> =>
      paginate(select(findOptions), findOptions),
    ),

    findBy: jest.fn(async (where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T[]> =>
      select({ where }),
    ),

    findOne: jest.fn(
      async (findOptions: FindOneOptions<T>): Promise<T | null> => select(findOptions)[0] ?? null,
    ),

    findOneBy: jest.fn(
      async (where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T | null> =>
        select({ where })[0] ?? null,
    ),

    findAndCount: jest.fn(async (findOptions?: FindManyOptions<T>): Promise<[T[], number]> => {
      const matched = select(findOptions);
      return [paginate(matched, findOptions), matched.length];
    }),

    count: jest.fn(
      async (findOptions?: FindManyOptions<T>): Promise<number> => select(findOptions).length,
    ),

    countBy: jest.fn(
      async (where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<number> =>
        select({ where }).length,
    ),

    exists: jest.fn(
      async (findOptions?: FindManyOptions<T>): Promise<boolean> => select(findOptions).length > 0,
    ),

    existsBy: jest.fn(
      async (where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<boolean> =>
        select({ where }).length > 0,
    ),

    update: jest.fn(async (criteria: unknown, partial: Partial<T>) => {
      const matches = criteriaMatcher(criteria);
      let affected = 0;
      for (const row of rows) {
        if (matches(row) && !isSoftDeleted(row)) {
          Object.assign(row, partial);
          affected += 1;
        }
      }
      return { affected, generatedMaps: [], raw: [] };
    }),

    delete: jest.fn(async (criteria: unknown) => {
      const matches = criteriaMatcher(criteria);
      const remaining = rows.filter((row) => !matches(row));
      const affected = rows.length - remaining.length;
      rows.length = 0;
      rows.push(...remaining);
      return { affected, raw: [] };
    }),

    softDelete: jest.fn(async (criteria: unknown) => {
      const matches = criteriaMatcher(criteria);
      let affected = 0;
      for (const row of rows) {
        if (matches(row) && !isSoftDeleted(row)) {
          asRecord(row).deletedAt = new Date();
          affected += 1;
        }
      }
      return { affected, generatedMaps: [], raw: [] };
    }),

    remove: jest.fn(async (entity: T | T[]): Promise<T | T[]> => {
      const targets = Array.isArray(entity) ? entity : [entity];
      const ids = new Set(targets.map((row) => row.id));
      const remaining = rows.filter((row) => !ids.has(row.id));
      rows.length = 0;
      rows.push(...remaining);
      return entity;
    }),

    softRemove: jest.fn(async (entity: T | T[]): Promise<T | T[]> => {
      for (const target of Array.isArray(entity) ? entity : [entity]) {
        asRecord(target).deletedAt = new Date();
        upsertOne(target);
      }
      return entity;
    }),

    clear: jest.fn(async (): Promise<void> => {
      rows.length = 0;
    }),
  };

  // One cast, in one place: the fixture implements the slice of `Repository<T>` that unit
  // tests actually exercise, and the proxy below turns everything else into a clear failure
  // instead of an `undefined is not a function`.
  const target = implementation as unknown as InMemoryRepository<T>;

  return new Proxy(target, {
    get(proxied, property, receiver): unknown {
      if (typeof property === 'string' && !(property in proxied)) {
        const reason = UNSUPPORTED.get(property);
        if (reason !== undefined) {
          throw new Error(`InMemoryRepository.${property}(): ${reason}`);
        }
      }
      return Reflect.get(proxied, property, receiver);
    },
  });
}
