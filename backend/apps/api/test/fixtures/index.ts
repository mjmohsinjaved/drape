/**
 * Test fixtures — DB-free unit testing in one import.
 *
 * ```ts
 * import { createServiceUnderTest } from '../../test/fixtures';
 * import { buildUser } from '../../test/factories';
 * ```
 *
 * `createInMemoryRepository` behaves like a repository rather than returning `undefined` for
 * anything unstubbed; `createTestingModule` wires those fixtures into a Nest module in one
 * call. Neither opens a connection, reads a file or binds a port — there is no PostgreSQL on
 * the development machine, and a unit test must never need one (CLAUDE.md).
 */
export * from './in-memory-repository';
export * from './testing-module';
