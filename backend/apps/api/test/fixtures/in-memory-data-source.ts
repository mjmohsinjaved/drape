import { createInMemoryRepository, type InMemoryRepository } from './in-memory-repository';

import type { DataSource, EntityManager, ObjectLiteral, QueryRunner } from 'typeorm';

/**
 * A `DataSource`-shaped double that never opens a socket.
 *
 * `apps/api/test/fixtures/testing-module.ts` fakes repositories one entity at a time,
 * which is right for a unit test that knows exactly which tables it touches. Booting
 * the whole `ApiModule` is the other case: `TypeOrmModule.forFeature([...])` builds a
 * repository provider for every entity every feature module registers, and each of
 * those factories injects the `DataSource` and calls `getRepository(entity)` on it
 * (see `@nestjs/typeorm/dist/typeorm.providers.js`).
 *
 * So this hands back an {@link InMemoryRepository} for whatever it is asked for,
 * creating one on first use. A module that adds an entity tomorrow needs no change
 * here — and, more importantly, a missing *provider* still fails the boot test,
 * because only the repository tokens are satisfied automatically.
 *
 * The three properties beyond `getRepository` are the ones `@nestjs/typeorm` reads:
 * `entityMetadatas` (to decide whether an entity is a tree), `options.type` (to
 * decide whether it is MongoDB) and `isInitialized` / `destroy()` (used by
 * `TypeOrmCoreModule`'s shutdown hook). `createQueryRunner()` is present so a service
 * that runs `runInTransaction` against this double gets a manager rather than a
 * `TypeError`.
 */
export interface InMemoryDataSource {
  /** The double, typed as the real thing so it can be handed to the container. */
  readonly dataSource: DataSource;
  /** The manager `getEntityManagerToken()` should be overridden with. */
  readonly manager: EntityManager;
  /** Every repository handed out so far, keyed by entity class. */
  readonly repositories: ReadonlyMap<unknown, InMemoryRepository<ObjectLiteral & { id: string }>>;
}

type AnyRepository = InMemoryRepository<ObjectLiteral & { id: string }>;

export function createInMemoryDataSource(): InMemoryDataSource {
  const repositories = new Map<unknown, AnyRepository>();

  const getRepository = (entity: unknown): AnyRepository => {
    const existing = repositories.get(entity);
    if (existing !== undefined) {
      return existing;
    }
    const created = createInMemoryRepository<ObjectLiteral & { id: string }>();
    repositories.set(entity, created);
    return created;
  };

  const manager = {
    getRepository,
    connection: undefined as unknown,
    save: async (entity: unknown, target: ObjectLiteral & { id: string }): Promise<unknown> =>
      getRepository(entity).save(target),
    find: async (entity: unknown): Promise<unknown> => getRepository(entity).find(),
  } as unknown as EntityManager;

  /** A runner whose transaction is a no-op: the repositories above are the store. */
  const queryRunner = {
    manager,
    isTransactionActive: false,
    connect: async (): Promise<void> => undefined,
    startTransaction: async (): Promise<void> => undefined,
    commitTransaction: async (): Promise<void> => undefined,
    rollbackTransaction: async (): Promise<void> => undefined,
    release: async (): Promise<void> => undefined,
  } as unknown as QueryRunner;

  const dataSource = {
    isInitialized: true,
    // Read by `createTypeOrmProviders` to choose between the plain, tree and Mongo
    // repository shapes. Neither list matches anything, so every entity gets the
    // plain one — which is what the in-memory double implements.
    entityMetadatas: [],
    options: { type: 'postgres' },
    manager,
    getRepository,
    getTreeRepository: getRepository,
    createQueryRunner: (): QueryRunner => queryRunner,
    destroy: async (): Promise<void> => undefined,
    query: async (): Promise<unknown[]> => [],
  } as unknown as DataSource;

  (manager as unknown as { connection: DataSource }).connection = dataSource;

  return { dataSource, manager, repositories };
}
