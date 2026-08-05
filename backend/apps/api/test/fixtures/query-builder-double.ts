import type { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

/**
 * A `SelectQueryBuilder` double that models the two TypeORM behaviours a bag of
 * `jest.fn()`s hides, and that between them cost us a guaranteed 500.
 *
 * ### 1 — `createQueryBuilder(alias)` seeds the select list
 *
 * `repository.createQueryBuilder('j')` does not start empty. It seeds
 * `expressionMap.selects` with the whole entity — the emitted SQL is
 * `SELECT "j"."id" AS "j_id", "j"."status" AS "j_status", … FROM "tryon_jobs" "j"`.
 * A stub that starts with an empty select list makes the difference between `.select()`
 * and `.addSelect()` invisible, which is exactly the difference that matters.
 *
 * ### 2 — `select()` replaces, `addSelect()` appends
 *
 * So a builder that only ever calls `addSelect` keeps the entity seed. Add an aggregate
 * beside it with no `GROUP BY` covering the seeded columns and PostgreSQL raises
 * `42803: column "j.id" must appear in the GROUP BY clause` — at runtime, on the first
 * request, from a service whose unit tests are all green.
 *
 * This double therefore **raises that error itself**. {@link assertGroupingIsValid} runs on
 * every terminal call (`getRawOne`, `getRawMany`, `getMany`, …) and applies PostgreSQL's
 * rule: when any selected expression is an aggregate, every other selected expression
 * must either be an aggregate too or appear in the `GROUP BY` list. A test written
 * against this double fails the way production fails, rather than passing and leaving
 * the 500 to an admin.
 *
 * It emulates nothing else. There are no rows in it and no `WHERE` evaluation: the
 * result of a terminal call is whatever the test seeds. This is a *shape* checker for
 * the one class of SQL defect that unit tests structurally cannot otherwise see — the
 * in-memory repository's refusal to emulate the query builder at all (see
 * `in-memory-repository.ts`) stands for everything else.
 */

/** The PostgreSQL error code for "column must appear in the GROUP BY clause". */
export const GROUPING_ERROR_CODE = '42803';

/** An aggregate call at the head of an expression — the set this codebase actually uses. */
const AGGREGATE_PATTERN =
  /\b(?:COUNT|SUM|AVG|MIN|MAX|BOOL_AND|BOOL_OR|ARRAY_AGG|STRING_AGG|PERCENTILE_CONT|PERCENTILE_DISC)\s*\(/i;

/** One entry of `expressionMap.selects`. */
export interface RecordedSelect {
  readonly expression: string;
  readonly alias?: string;
}

/** What the double recorded, so a spec can assert on the query rather than on a mock call. */
export interface QueryBuilderRecording {
  readonly alias: string;
  /** The effective select list, in order, after every `select`/`addSelect`. */
  readonly selects: readonly RecordedSelect[];
  readonly groupBys: readonly string[];
  readonly wheres: readonly string[];
  readonly orderBys: readonly string[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly limit: number | null;
  readonly offset: number | null;
  /** True when `select()` was never called and the entity seed is still in the list. */
  readonly seedRetained: boolean;
}

/** A simulated PostgreSQL grouping error, carrying the real `code` service code branches on. */
export class SimulatedGroupingError extends Error {
  readonly code = GROUPING_ERROR_CODE;
  readonly driverError: { code: string };

  constructor(message: string) {
    super(message);
    this.name = 'SimulatedGroupingError';
    this.driverError = { code: GROUPING_ERROR_CODE };
  }
}

export interface QueryBuilderDoubleOptions {
  /** Rows the terminal calls resolve with. `getRawOne` takes the first. */
  readonly rows?: readonly ObjectLiteral[];
}

/** Handles for inspecting what the service built. */
export interface QueryBuilderDoubleControls {
  /** Every builder created through this factory, in creation order. */
  readonly $builders: readonly QueryBuilderRecording[];
  /** The most recently created builder. Throws when none was created. */
  $last(): QueryBuilderRecording;
  /** Replaces the rows terminal calls resolve with. */
  $setRows(rows: readonly ObjectLiteral[]): void;
}

function isAggregate(expression: string): boolean {
  return AGGREGATE_PATTERN.test(expression);
}

/** `j.errorCode`, `j."errorCode"` and `"j"."errorCode"` are the same column. */
function normaliseColumn(expression: string): string {
  return expression.replace(/["`]/g, '').trim().toLowerCase();
}

/**
 * PostgreSQL's rule, applied to a recorded select list.
 *
 * Only enforced once something in the list *is* an aggregate: a plain projection with no
 * aggregate needs no `GROUP BY` at all, which is the ordinary row-fetching case.
 *
 * @throws {SimulatedGroupingError} carrying `code = '42803'`
 */
export function assertGroupingIsValid(recording: QueryBuilderRecording): void {
  const aggregated = recording.selects.some((entry) => isAggregate(entry.expression));
  if (!aggregated) {
    return;
  }

  const grouped = new Set(recording.groupBys.map(normaliseColumn));

  for (const entry of recording.selects) {
    if (isAggregate(entry.expression)) {
      continue;
    }

    // The entity seed stands for every column of the table, so a positional `GROUP BY 1`
    // or a group on one column never covers it.
    const offending =
      entry.expression === entitySeedOf(recording.alias)
        ? `${recording.alias}.id`
        : entry.expression;

    if (!grouped.has(normaliseColumn(entry.expression))) {
      throw new SimulatedGroupingError(
        `column "${normaliseColumn(offending)}" must appear in the GROUP BY clause or be used ` +
          'in an aggregate function. The builder mixed a bare column with an aggregate — ' +
          'call .select() before .addSelect() so the entity seed is replaced rather than kept.',
      );
    }
  }
}

/** The pseudo-expression standing for "every column of the aliased entity". */
export function entitySeedOf(alias: string): string {
  return `${alias}.*`;
}

/**
 * Builds a `createQueryBuilder` implementation that models the seed-and-append semantics.
 *
 * ```ts
 * const builders = createQueryBuilderDouble({ rows: [{ b0: '2' }] });
 * repository.createQueryBuilder = builders.factory;
 * await service.somethingAggregated();      // throws 42803 if the select list is wrong
 * expect(builders.$last().seedRetained).toBe(false);
 * ```
 */
export function createQueryBuilderDouble(options: QueryBuilderDoubleOptions = {}): {
  factory: (alias: string) => SelectQueryBuilder<ObjectLiteral>;
} & QueryBuilderDoubleControls {
  const builders: QueryBuilderRecording[] = [];
  let rows: ObjectLiteral[] = [...(options.rows ?? [])];

  const factory = (alias: string): SelectQueryBuilder<ObjectLiteral> => {
    // The seed TypeORM writes for you. Everything below depends on it being here.
    const selects: RecordedSelect[] = [{ expression: entitySeedOf(alias) }];
    const groupBys: string[] = [];
    const wheres: string[] = [];
    const orderBys: string[] = [];
    const parameters: Record<string, unknown> = {};
    let limit: number | null = null;
    let offset: number | null = null;
    let seedRetained = true;

    const recording: QueryBuilderRecording = {
      alias,
      get selects(): readonly RecordedSelect[] {
        return selects;
      },
      get groupBys(): readonly string[] {
        return groupBys;
      },
      get wheres(): readonly string[] {
        return wheres;
      },
      get orderBys(): readonly string[] {
        return orderBys;
      },
      get parameters(): Readonly<Record<string, unknown>> {
        return parameters;
      },
      get limit(): number | null {
        return limit;
      },
      get offset(): number | null {
        return offset;
      },
      get seedRetained(): boolean {
        return seedRetained;
      },
    };
    builders.push(recording);

    const mergeParameters = (next?: Record<string, unknown>): void => {
      if (next !== undefined) {
        Object.assign(parameters, next);
      }
    };

    const builder = {
      select(expression: string, selectAlias?: string): unknown {
        // Replaces. This is the whole point of the double.
        selects.length = 0;
        selects.push({ expression, alias: selectAlias });
        seedRetained = false;
        return builder;
      },
      addSelect(expression: string, selectAlias?: string): unknown {
        selects.push({ expression, alias: selectAlias });
        return builder;
      },
      where(expression: string, next?: Record<string, unknown>): unknown {
        wheres.length = 0;
        wheres.push(expression);
        mergeParameters(next);
        return builder;
      },
      andWhere(expression: string, next?: Record<string, unknown>): unknown {
        wheres.push(expression);
        mergeParameters(next);
        return builder;
      },
      orWhere(expression: string, next?: Record<string, unknown>): unknown {
        wheres.push(expression);
        mergeParameters(next);
        return builder;
      },
      setParameters(next: Record<string, unknown>): unknown {
        mergeParameters(next);
        return builder;
      },
      setParameter(name: string, value: unknown): unknown {
        parameters[name] = value;
        return builder;
      },
      groupBy(expression: string): unknown {
        groupBys.length = 0;
        groupBys.push(expression);
        return builder;
      },
      addGroupBy(expression: string): unknown {
        groupBys.push(expression);
        return builder;
      },
      having(expression: string, next?: Record<string, unknown>): unknown {
        mergeParameters(next);
        wheres.push(`HAVING ${expression}`);
        return builder;
      },
      orderBy(expression: string): unknown {
        orderBys.length = 0;
        orderBys.push(expression);
        return builder;
      },
      addOrderBy(expression: string): unknown {
        orderBys.push(expression);
        return builder;
      },
      limit(value: number): unknown {
        limit = value;
        return builder;
      },
      take(value: number): unknown {
        limit = value;
        return builder;
      },
      offset(value: number): unknown {
        offset = value;
        return builder;
      },
      skip(value: number): unknown {
        offset = value;
        return builder;
      },
      leftJoin(): unknown {
        return builder;
      },
      innerJoin(): unknown {
        return builder;
      },
      withDeleted(): unknown {
        return builder;
      },

      async getRawOne(): Promise<ObjectLiteral | undefined> {
        assertGroupingIsValid(recording);
        return rows[0];
      },
      async getRawMany(): Promise<ObjectLiteral[]> {
        assertGroupingIsValid(recording);
        return [...rows];
      },
      async getMany(): Promise<ObjectLiteral[]> {
        assertGroupingIsValid(recording);
        return [...rows];
      },
      async getOne(): Promise<ObjectLiteral | null> {
        assertGroupingIsValid(recording);
        return rows[0] ?? null;
      },
      async getCount(): Promise<number> {
        return rows.length;
      },
    };

    return builder as unknown as SelectQueryBuilder<ObjectLiteral>;
  };

  return {
    factory,
    get $builders(): readonly QueryBuilderRecording[] {
      return builders;
    },
    $last(): QueryBuilderRecording {
      const last = builders[builders.length - 1];
      if (last === undefined) {
        throw new Error('No query builder was created.');
      }
      return last;
    },
    $setRows(next: readonly ObjectLiteral[]): void {
      rows = [...next];
    },
  };
}

/**
 * Installs the double onto a repository (in-memory or otherwise) and returns its controls.
 *
 * The in-memory repository throws on `createQueryBuilder` by design; assigning over it is
 * the explicit stub its own error message asks for.
 */
export function installQueryBuilderDouble<T extends ObjectLiteral>(
  repository: Repository<T>,
  options: QueryBuilderDoubleOptions = {},
): ReturnType<typeof createQueryBuilderDouble> {
  const double = createQueryBuilderDouble(options);
  Object.defineProperty(repository, 'createQueryBuilder', {
    configurable: true,
    writable: true,
    value: jest.fn(double.factory),
  });
  return double;
}

/* -------------------------------------------------------------------------------------------------
 * The atomic UPDATE form
 * ---------------------------------------------------------------------------------------------- */

/**
 * `GREATEST(0, "column" ± n)` — the one SQL expression this double evaluates.
 *
 * Deliberately a single, named shape rather than an expression evaluator. Anything else
 * throws, so a test cannot quietly get a wrong answer from a half-implemented parser.
 */
const GREATEST_ZERO_DELTA =
  /^GREATEST\(\s*0\s*,\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*([+-])\s*(\d+)\s*\)$/i;

/**
 * A double for `repository.createQueryBuilder().update(E).set({…}).where(…).execute()`.
 *
 * ### Why this is worth emulating when the query builder generally is not
 *
 * The value of that idiom is entirely in *when* the row is read. `SET "n" = "n" + 1` reads
 * and writes under the row lock, in one statement; the read-modify-write it replaces
 * (`findOne`, add in JavaScript, `update`) has a suspension point in the middle, and two
 * callers that both pass through it lose one of the two increments.
 *
 * A stub that just records the call cannot tell those apart — both "work". This one
 * evaluates the expression **at `execute()` time against the live row**, so a test that
 * interleaves two updates gets the atomic answer from the atomic idiom and the lost-update
 * answer from the other one. That is the difference the fix is about, and this is the only
 * way to see it without PostgreSQL.
 *
 * Plain (non-function) values in `set()` are assigned as-is. `where` supports the single
 * form these call sites use: `'<column> = :<param>'`.
 */
export function installUpdateQueryBuilderDouble<T extends ObjectLiteral & { id: string }>(
  repository: Repository<T> & { $rows: T[] },
): void {
  const factory = (): unknown => {
    let assignments: Record<string, unknown> = {};
    let predicate: (row: T) => boolean = () => false;
    const parameters: Record<string, unknown> = {};

    const builder = {
      update(): unknown {
        return builder;
      },
      set(values: Record<string, unknown>): unknown {
        assignments = values;
        return builder;
      },
      where(expression: string, params: Record<string, unknown> = {}): unknown {
        Object.assign(parameters, params);
        const match = /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=\s*:(\w+)\s*$/.exec(expression);
        if (match === null) {
          throw new Error(
            `The update-query-builder double only understands '<column> = :<param>'. Got: ${expression}`,
          );
        }
        const [, column, parameter] = match;
        predicate = (row): boolean => (row as ObjectLiteral)[column] === parameters[parameter];
        return builder;
      },
      andWhere(expression: string, params?: Record<string, unknown>): unknown {
        return builder.where(expression, params);
      },
      async execute(): Promise<{ affected: number; raw: unknown[]; generatedMaps: unknown[] }> {
        let affected = 0;

        for (const row of repository.$rows) {
          if (!predicate(row)) {
            continue;
          }

          for (const [column, value] of Object.entries(assignments)) {
            // The whole point: the current value is read **now**, inside the statement.
            (row as ObjectLiteral)[column] =
              typeof value === 'function'
                ? evaluateSqlAssignment(String((value as () => string)()), row)
                : value;
          }
          affected += 1;
        }

        return { affected, raw: [], generatedMaps: [] };
      },
    };

    return builder;
  };

  Object.defineProperty(repository, 'createQueryBuilder', {
    configurable: true,
    writable: true,
    value: jest.fn(factory),
  });
}

function evaluateSqlAssignment(expression: string, row: ObjectLiteral): number {
  const match = GREATEST_ZERO_DELTA.exec(expression.trim());
  if (match === null) {
    throw new Error(
      `The update-query-builder double cannot evaluate this SQL: ${expression}. It models ` +
        'GREATEST(0, "column" ± n) and nothing else — extend it deliberately rather than ' +
        'guessing at semantics.',
    );
  }

  const [, column, sign, amount] = match;
  const current = Number(row[column] ?? 0);
  const delta = Number(amount) * (sign === '-' ? -1 : 1);
  return Math.max(0, current + delta);
}
