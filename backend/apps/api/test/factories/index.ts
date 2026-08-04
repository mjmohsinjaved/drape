/**
 * Typed entity factories for the unit and e2e suites.
 *
 * ```ts
 * import { buildConsumerShortlist, buildPublishedGarment, buildUser } from '../../test/factories';
 * ```
 *
 * Every factory returns a real instance of the real entity class with every column
 * populated to a valid value, and takes a `Partial<Entity>` of overrides. A test states only
 * what it is about; the schema states the rest. When a column changes, these files stop
 * compiling — which is the point.
 *
 * Nothing here touches a database, and nothing here builds an absolute path: storage keys
 * come from the `@library/storage` key builder, exactly as production does (§3.3,
 * CLAUDE.md).
 */
export * from './category.factory';
export * from './enquiry.factory';
export * from './factory.support';
export * from './garment.factory';
export * from './person-photo.factory';
export * from './quota-ledger.factory';
export * from './session.factory';
export * from './shortlist-item.factory';
export * from './tryon-job.factory';
export * from './tryon-result.factory';
export * from './user.factory';
