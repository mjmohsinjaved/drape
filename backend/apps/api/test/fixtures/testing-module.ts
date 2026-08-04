import type { InjectionToken, ModuleMetadata, Provider, Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { createInMemoryRepository, type InMemoryRepository } from './in-memory-repository';

import type { EntityManager, ObjectLiteral } from 'typeorm';

/**
 * Builds a Nest testing module with in-memory repositories, in one call.
 *
 * There is no database on this machine (CLAUDE.md), so every unit test needs the same
 * three-step dance: build the module, provide a fake for each `@InjectRepository`, then
 * fish the fakes back out to arrange rows. This does all three.
 *
 * ```ts
 * const harness = await createTestingModule({
 *   providers: [ShortlistService],
 *   repositories: [
 *     { entity: ShortlistItem, rows: buildRankedShortlist(userId, garmentIds) },
 *     { entity: Garment },
 *   ],
 * });
 *
 * const service = harness.get(ShortlistService);
 * const items = harness.repository(ShortlistItem);
 * ```
 *
 * Nothing here starts a connection, reads a file or opens a port.
 */

/** Any entity class. Kept structural so it does not depend on a particular base class. */
export type EntityClass = new (...args: never[]) => object;

export interface RepositoryFixtureSpec {
  readonly entity: EntityClass;
  /** Rows present before the test runs. */
  readonly rows?: readonly (ObjectLiteral & { id: string })[];
}

export interface TestingModuleOptions {
  readonly providers?: readonly Provider[];
  readonly controllers?: readonly Type[];
  readonly imports?: ModuleMetadata['imports'];
  /**
   * Entities whose repository should be faked. Give `rows` to pre-populate, or just the
   * class for an empty one.
   */
  readonly repositories?: readonly (RepositoryFixtureSpec | EntityClass)[];
  /** Extra token → value pairs: services, config, an emitter, a storage double. */
  readonly overrides?: readonly { readonly token: InjectionToken; readonly value: unknown }[];
}

export interface TestHarness {
  readonly module: TestingModule;
  /** Resolves a provider. */
  get<T>(token: InjectionToken): T;
  /** The in-memory repository registered for an entity. Throws if it was not declared. */
  repository<T extends ObjectLiteral & { id: string }>(entity: EntityClass): InMemoryRepository<T>;
  /**
   * A `DataSource`-shaped double whose `transaction()` runs the callback immediately with a
   * manager backed by the same repositories. §2.9 rule 3 puts every multi-table write inside
   * a transaction, so most services need this.
   */
  readonly dataSource: FakeDataSource;
  close(): Promise<void>;
}

/** The slice of `DataSource` a service typically touches in a unit test. */
export interface FakeDataSource {
  transaction<T>(runInTransaction: (manager: EntityManager) => Promise<T>): Promise<T>;
  getRepository<T extends ObjectLiteral & { id: string }>(
    entity: EntityClass,
  ): InMemoryRepository<T>;
  readonly manager: EntityManager;
}

function normaliseSpec(spec: RepositoryFixtureSpec | EntityClass): RepositoryFixtureSpec {
  return typeof spec === 'function' ? { entity: spec } : spec;
}

/**
 * A manager backed by the same repository fixtures, so work inside `transaction()` is
 * visible to assertions made outside it.
 */
function createFakeManager(
  lookup: (entity: EntityClass) => InMemoryRepository<ObjectLiteral & { id: string }>,
): {
  manager: EntityManager;
  dataSource: FakeDataSource;
} {
  const manager = {
    getRepository: lookup,
    // Convenience passthroughs — a service reaching for these in a unit test usually wants
    // the repository anyway.
    save: async (entity: EntityClass, target: ObjectLiteral & { id: string }): Promise<unknown> =>
      lookup(entity).save(target),
    find: async (entity: EntityClass): Promise<unknown> => lookup(entity).find(),
  } as unknown as EntityManager;

  const dataSource: FakeDataSource = {
    manager,
    getRepository: <T extends ObjectLiteral & { id: string }>(
      entity: EntityClass,
    ): InMemoryRepository<T> => lookup(entity) as unknown as InMemoryRepository<T>,
    transaction: async <T>(
      runInTransaction: (transactional: EntityManager) => Promise<T>,
    ): Promise<T> => runInTransaction(manager),
  };

  return { manager, dataSource };
}

export async function createTestingModule(
  options: TestingModuleOptions = {},
): Promise<TestHarness> {
  const specs = (options.repositories ?? []).map(normaliseSpec);

  const repositories = new Map<EntityClass, InMemoryRepository<ObjectLiteral & { id: string }>>();
  for (const spec of specs) {
    repositories.set(spec.entity, createInMemoryRepository({ rows: spec.rows }));
  }

  const lookup = (entity: EntityClass): InMemoryRepository<ObjectLiteral & { id: string }> => {
    const repository = repositories.get(entity);
    if (repository === undefined) {
      throw new Error(
        `No repository fixture registered for ${entity.name}. Add it to createTestingModule({ repositories: [...] }).`,
      );
    }
    return repository;
  };

  const { dataSource } = createFakeManager(lookup);

  const repositoryProviders: Provider[] = specs.map((spec) => ({
    // `getRepositoryToken` is the same token `@InjectRepository(Entity)` resolves.
    provide: getRepositoryToken(spec.entity as Parameters<typeof getRepositoryToken>[0]),
    useValue: repositories.get(spec.entity),
  }));

  const overrideProviders: Provider[] = (options.overrides ?? []).map((override) => ({
    provide: override.token,
    useValue: override.value,
  }));

  const module = await Test.createTestingModule({
    imports: [...(options.imports ?? [])],
    controllers: [...(options.controllers ?? [])],
    providers: [...(options.providers ?? []), ...repositoryProviders, ...overrideProviders],
  }).compile();

  return {
    module,
    get: <T>(token: InjectionToken): T => module.get<T>(token, { strict: false }),
    repository: <T extends ObjectLiteral & { id: string }>(
      entity: EntityClass,
    ): InMemoryRepository<T> => lookup(entity) as unknown as InMemoryRepository<T>,
    dataSource,
    close: async (): Promise<void> => {
      await module.close();
    },
  };
}

/**
 * The common case in one line: build a module around a single service and return it
 * alongside the harness.
 *
 * ```ts
 * const { service, harness } = await createServiceUnderTest(QuotaService, {
 *   repositories: [QuotaLedgerEntry, Setting],
 * });
 * ```
 */
export async function createServiceUnderTest<T>(
  service: Type<T>,
  options: TestingModuleOptions = {},
): Promise<{ service: T; harness: TestHarness }> {
  const harness = await createTestingModule({
    ...options,
    providers: [service, ...(options.providers ?? [])],
  });

  return { service: harness.get<T>(service), harness };
}

/**
 * A typed jest double for a collaborator — a service, a driver, a provider interface.
 *
 * ```ts
 * const storage = createMock<StorageService>(['put', 'signDownloadUrl']);
 * storage.signDownloadUrl.mockReturnValue('https://api.test/api/v1/files/token');
 * ```
 *
 * Only the named methods exist at runtime. Anything else fails with "not a function", which
 * is the correct outcome: a collaborator the test never declared is one it should not be
 * calling.
 */
export function createMock<T extends object>(methods: readonly (keyof T)[]): jest.Mocked<T> {
  const mock: Record<string, jest.Mock> = {};
  for (const method of methods) {
    mock[String(method)] = jest.fn();
  }
  return mock as unknown as jest.Mocked<T>;
}
