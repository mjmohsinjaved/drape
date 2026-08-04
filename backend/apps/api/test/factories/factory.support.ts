import { createHash, randomUUID } from 'node:crypto';

/**
 * Shared plumbing for the entity factories.
 *
 * The factories exist so a test can say what it is actually about — "a suspended consumer",
 * "a render whose garment was archived" — instead of restating thirty columns it does not
 * care about. Everything a factory produces is a valid instance of the real entity class,
 * so a schema change breaks the factory at compile time rather than silently producing rows
 * the database would reject.
 *
 * Nothing here touches a database. These are in-memory instances.
 */

/** Constructor shape every TypeORM entity satisfies. */
export type EntityConstructor<T> = new () => T;

/**
 * Builds an entity instance from defaults plus caller overrides.
 *
 * A real instance, not an object literal: services use `instanceof`, class-transformer
 * reads decorator metadata off the prototype, and TypeORM's `save()` cares.
 */
export function buildEntity<T extends object>(
  EntityClass: EntityConstructor<T>,
  defaults: Partial<T>,
  overrides: Partial<T>,
): T {
  return Object.assign(new EntityClass(), defaults, overrides);
}

let counter = 0;

/**
 * Monotonic counter for values that must be unique within a test file — SKUs, slugs,
 * email addresses, enquiry references.
 *
 * Deliberately not reset between tests: uniqueness is the point, and a counter that
 * restarted at 1 would let two "different" fixtures collide on a unique index.
 */
export function nextSequence(): number {
  counter += 1;
  return counter;
}

/** A fresh v4 UUID — every primary key in the schema is one (§4.0 rule 1). */
export function uuid(): string {
  return randomUUID();
}

/**
 * A deterministic 64-character hex digest, the shape of every `char(64)` hash column
 * (`hash`, `tokenHash`, `cacheKey`, `emailHash`, `voterFingerprint`).
 *
 * Deterministic on purpose: two fixtures built from the same seed string produce the same
 * hash, which is what a §3.7 cache-hit test needs, and different seeds reliably miss.
 */
export function hash64(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

/** `YYYY-MM` — the `char(7)` ledger period (§4.26, §4.27). */
export function periodOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * A password-hash-shaped string that is NOT a real Argon2id hash and will never verify.
 *
 * Hashing for real costs ~50 ms per fixture, and a test that needs verification to succeed
 * should hash its own password explicitly so the intent is visible.
 */
export const FAKE_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$dGVzdHNhbHR0ZXN0c2FsdA$bm90LWEtcmVhbC1oYXNoLW5vdC1hLXJlYWwtaGFzaA';
