import type {
  DataSource,
  EntityManager,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

/**
 * Test doubles for the two things this module's unit tests cannot get from the
 * shared fixtures: a **recording query builder** and a **transactional
 * `DataSource`**.
 *
 * `apps/api/test/fixtures/in-memory-repository.ts` refuses to emulate
 * `createQueryBuilder()` on purpose — "ownership and visibility predicates live
 * there, and pretending to emulate it would give a test false confidence about the
 * one thing most worth verifying". That refusal is correct, and it is exactly why
 * this file does not emulate the query builder either.
 *
 * {@link createQueryBuilderSpy} does something different and, for S-10, more useful:
 * it **records what the query was asked to do** and hands back canned rows. A test
 * can then assert on the query itself — that `person_photos` is never named, that
 * the render query joins `enquiry_items`, that the enquiry is scoped to the same
 * consumer — instead of trusting a re-implementation of PostgreSQL to filter
 * correctly.
 */

/** One recorded call on the builder. */
export interface QueryBuilderCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface QueryBuilderSpyOptions<T> {
  /** Rows returned by `getMany` / `getOne` / `getManyAndCount`. */
  readonly many?: readonly T[];
  /** Rows returned by `getRawMany` / `getRawOne`. */
  readonly raw?: readonly unknown[];
  /** Value returned by `getCount` and the count half of `getManyAndCount`. */
  readonly count?: number;
  /** The builder's own alias, as `paginate()` reads it. */
  readonly alias?: string;
}

export interface QueryBuilderSpy<T extends ObjectLiteral> {
  /** The double, typed as the real thing so it can be handed to production code. */
  readonly builder: SelectQueryBuilder<T>;
  readonly calls: readonly QueryBuilderCall[];
  /**
   * Every string the query was built from: SQL fragments, selected columns, join
   * conditions, and the **names of entity classes** passed as join targets. This is
   * the surface an S-10 assertion runs against.
   */
  fragments(): string[];
  /** All of the above joined, for a single readable `expect(...).not.toContain()`. */
  sql(): string;
  /** Arguments of every call to one method, e.g. `argsFor('innerJoin')`. */
  argsFor(method: string): ReadonlyArray<readonly unknown[]>;
  /** Whether a method was called at all. */
  called(method: string): boolean;
}

const TERMINAL_METHODS = new Set([
  'getMany',
  'getOne',
  'getManyAndCount',
  'getRawMany',
  'getRawOne',
  'getCount',
  'getRawAndEntities',
  'execute',
]);

/**
 * A `SelectQueryBuilder` that records instead of querying.
 *
 * Every chainable method returns the same instance and appends a call, including
 * `clone()` — so a service that clones a builder to add a projection still
 * contributes its fragments to one list, which is what makes "this query never
 * mentions `person_photos`" assertable in a single expectation.
 */
export function createQueryBuilderSpy<T extends ObjectLiteral>(
  options: QueryBuilderSpyOptions<T> = {},
): QueryBuilderSpy<T> {
  const calls: QueryBuilderCall[] = [];
  const many = [...(options.many ?? [])];
  const raw = [...(options.raw ?? [])];
  const count = options.count ?? many.length + raw.length;
  const alias = options.alias ?? 'entity';

  const target: Record<string, unknown> = {};

  const proxy = new Proxy(target, {
    get(_carrier, property): unknown {
      if (typeof property !== 'string') {
        return undefined;
      }
      // Never look like a thenable: `await builder` must not resolve by accident.
      if (property === 'then' || property === 'catch' || property === 'finally') {
        return undefined;
      }
      if (property === 'alias') {
        return alias;
      }
      if (property === 'expressionMap') {
        return { mainAlias: { name: alias } };
      }

      return (...args: unknown[]): unknown => {
        calls.push({ method: property, args });

        if (!TERMINAL_METHODS.has(property)) {
          return proxy;
        }

        switch (property) {
          case 'getMany':
            return Promise.resolve(many);
          case 'getOne':
            return Promise.resolve(many[0] ?? null);
          case 'getManyAndCount':
            return Promise.resolve([many, count]);
          case 'getRawMany':
          case 'execute':
            return Promise.resolve(raw);
          case 'getRawOne':
            return Promise.resolve(raw[0] ?? null);
          case 'getRawAndEntities':
            return Promise.resolve({ entities: many, raw });
          default:
            return Promise.resolve(count);
        }
      };
    },
  });

  const fragments = (): string[] => {
    const found: string[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        found.push(value);
        return;
      }
      if (typeof value === 'function') {
        // `innerJoin(Enquiry, 'enquiry', '…')` — the entity class is part of the query.
        found.push(value.name);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value !== null && typeof value === 'object') {
        Object.entries(value).forEach(([key, nested]) => {
          found.push(key);
          visit(nested);
        });
      }
    };

    for (const call of calls) {
      found.push(call.method);
      call.args.forEach(visit);
    }
    return found;
  };

  return {
    builder: proxy as unknown as SelectQueryBuilder<T>,
    calls,
    fragments,
    sql: () => fragments().join(' │ '),
    argsFor: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
    called: (method) => calls.some((call) => call.method === method),
  };
}

/**
 * Points a repository double's `createQueryBuilder()` at a spy.
 *
 * The shared in-memory repository throws on `createQueryBuilder` by design; writing
 * the property onto it satisfies the proxy's `in` check and replaces the refusal
 * with a recorder.
 */
export function attachQueryBuilder<T extends ObjectLiteral>(
  repository: Repository<T>,
  spy: QueryBuilderSpy<T>,
): jest.Mock {
  const factory = jest.fn(() => spy.builder);
  (repository as unknown as Record<string, unknown>).createQueryBuilder = factory;
  return factory;
}

/** What a transaction did, for assertions that a write really was atomic. */
export interface TransactionState {
  started: number;
  committed: number;
  rolledBack: number;
  released: number;
}

export interface TransactionalDataSourceDouble {
  readonly dataSource: DataSource;
  readonly state: TransactionState;
}

/**
 * A `DataSource` whose `createQueryRunner()` hands `runInTransaction` a runner
 * backed by `manager`.
 *
 * `runInTransaction` is the only sanctioned way to span two writes (§2.9 rule 3), so
 * a service that uses it needs a real-shaped runner in a unit test — and a test that
 * asserts `state.committed === 1` is asserting the write was atomic, not just that
 * it happened.
 */
export function createTransactionalDataSource(
  manager: EntityManager,
): TransactionalDataSourceDouble {
  const state: TransactionState = { started: 0, committed: 0, rolledBack: 0, released: 0 };

  /** Counts the step and resolves. Not `async`: there is nothing here to await. */
  const step = (record: () => void): (() => Promise<void>) => {
    return () => {
      record();
      return Promise.resolve();
    };
  };

  const queryRunner = {
    manager,
    get isTransactionActive(): boolean {
      return state.started > state.committed + state.rolledBack;
    },
    connect: step(() => undefined),
    startTransaction: step(() => {
      state.started += 1;
    }),
    commitTransaction: step(() => {
      state.committed += 1;
    }),
    rollbackTransaction: step(() => {
      state.rolledBack += 1;
    }),
    release: step(() => {
      state.released += 1;
    }),
  };

  const dataSource = {
    createQueryRunner: (): unknown => queryRunner,
  } as unknown as DataSource;

  return { dataSource, state };
}

/** Any entity class, kept structural so it does not depend on a base class. */
export type EntityClass = new (...args: never[]) => object;

/**
 * An `EntityManager` whose `getRepository()` resolves to the same doubles the
 * service holds outside the transaction, so a write made inside `runInTransaction`
 * is visible to assertions made after it.
 */
export function createFakeEntityManager(
  repositories: ReadonlyMap<EntityClass, unknown>,
): EntityManager {
  const manager = {
    getRepository: (entity: EntityClass): unknown => {
      const repository = repositories.get(entity);
      if (repository === undefined) {
        throw new Error(
          `No repository double registered for ${entity.name}. Add it to createFakeEntityManager().`,
        );
      }
      return repository;
    },
  };

  return manager as unknown as EntityManager;
}
