import { hasApprovedTestRender } from '@api/modules/garments';
import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';

import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * **The public visibility predicate — PRD A-11, ARCHITECTURE §5.8, E-10.**
 *
 * > E-10: "A test asserts that no garment lacking an approved test render can appear
 * > in the consumer catalog."
 * >
 * > §5.8: "`E-10` asserts that no garment lacking an approved test render is ever
 * > returned by any route in this group."
 *
 * This file is the single place that decides what a signed-out visitor may see.
 * Every query in `CatalogService` is built by {@link publicGarmentScope}, and every
 * row that comes back is put through {@link isPubliclyVisible} before it reaches a
 * mapper. Two layers, deliberately:
 *
 * - the **SQL scope** is what makes the query correct and the index usable;
 * - the **row predicate** is what makes a mistake in some future query harmless. If
 *   somebody adds a fifth catalog route and forgets the scope, the rows are still
 *   filtered, and the test suite still fails — because the E-10 spec feeds
 *   deliberately-invisible rows back through the service and asserts nothing comes out.
 *
 * A belt as well as braces is warranted here and almost nowhere else: this is the
 * rule that stands between an unproven try-on and a consumer's screen.
 *
 * `hasApprovedTestRender` is imported from `garments` rather than re-derived. "An
 * approved test render" meaning one thing at publish time and another at browse time
 * is exactly the gap E-10 exists to close.
 */

/** The alias every catalog query uses for `garments`. */
export const CATALOG_GARMENT_ALIAS = 'garment';

/** The alias every catalog query uses for the joined `categories` row. */
export const CATALOG_CATEGORY_ALIAS = 'category';

/**
 * Narrows a `garments` query builder to what the public may see.
 *
 * Three conditions, all required:
 *  1. not soft-deleted;
 *  2. `publishState = PUBLISHED` — so a draft *and* an archived garment are both out
 *     (A-13: archiving is how a piece leaves the catalog while keeping its history);
 *  3. `testRenderState = APPROVED` **and** `testRenderApprovedAt IS NOT NULL` — A-11.
 *
 * Both test-render columns are checked. The state alone would admit a row approved by
 * a half-applied migration or a hand-edited database, and the timestamp is the
 * evidence that an admin actually approved it.
 */
export function publicGarmentScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string = CATALOG_GARMENT_ALIAS,
): SelectQueryBuilder<T> {
  return qb
    .andWhere(`${alias}.deletedAt IS NULL`)
    .andWhere(`${alias}.publishState = :publicPublishState`, {
      publicPublishState: PublishState.PUBLISHED,
    })
    .andWhere(`${alias}.testRenderState = :publicTestRenderState`, {
      publicTestRenderState: TestRenderState.APPROVED,
    })
    .andWhere(`${alias}.testRenderApprovedAt IS NOT NULL`);
}

/**
 * The same rule, applied to a row that has already been loaded.
 *
 * Used as a last filter on everything the catalog is about to return, and asserted
 * exhaustively by the E-10 spec across every combination of publish state, test-render
 * state, approval timestamp and soft deletion.
 */
export function isPubliclyVisible(garment: Garment): boolean {
  return (
    garment.deletedAt === null &&
    garment.publishState === PublishState.PUBLISHED &&
    hasApprovedTestRender(garment)
  );
}

/**
 * Drops anything the public must not see from a loaded row set.
 *
 * `CatalogService` runs every result through this, list and detail alike, so that
 * "which rows may leave this module" has one answer rather than one per route.
 */
export function onlyPubliclyVisible(garments: readonly Garment[]): Garment[] {
  return garments.filter(isPubliclyVisible);
}
