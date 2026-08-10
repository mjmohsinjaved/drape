import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';

import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * **The public visibility predicate — ARCHITECTURE §5.8.**
 *
 * This file is the single place that decides what a signed-out visitor may see.
 * Every query in `CatalogService` is built by {@link publicGarmentScope}, and every
 * row that comes back is put through {@link isPubliclyVisible} before it reaches a
 * mapper. Two layers, deliberately:
 *
 * - the **SQL scope** is what makes the query correct and the index usable;
 * - the **row predicate** is what makes a mistake in some future query harmless. If
 *   somebody adds a fifth catalog route and forgets the scope, the rows are still
 *   filtered, and the test suite still fails — because the spec feeds deliberately
 *   invisible rows back through the service and asserts nothing comes out.
 *
 * Both layers are kept even though the rule they enforce is now a single column,
 * because the cost is one predicate and the thing being prevented is a draft piece
 * leaking into the public catalogue.
 *
 * ### The approved-test-render condition is gone
 *
 * It used to be the second half of this rule, alongside `checkGarmentReady` in the
 * try-on guard: a published garment whose test render had not been separately approved
 * was hidden from browse and refused at try-on. Between them, "published" did not mean
 * published — an admin who clicked the button got a piece nobody could see.
 *
 * **This is a deliberate departure from A-11 and E-10, and it was asked for.**
 * Publishing is now the whole decision. `evaluatePublishAdvisories` still reports a
 * missing test render, a missing try-on source and a low quality score at the moment of
 * publishing, and records whatever was overridden in the audit trail (A-4) — advice, not
 * a veto.
 *
 * What that costs: an unproven try-on can reach a consumer. A generation that fails
 * upstream charges no quota and no budget (§8.3), and `UPSTREAM_NO_GARMENT_DETECTED`
 * flags the piece for review (A-15), so the catalogue-health screen — not this
 * predicate — is now where a bad try-on source is caught.
 */

/** The alias every catalog query uses for `garments`. */
export const CATALOG_GARMENT_ALIAS = 'garment';

/** The alias every catalog query uses for the joined `categories` row. */
export const CATALOG_CATEGORY_ALIAS = 'category';

/**
 * Narrows a `garments` query builder to what the public may see.
 *
 * Two conditions, both required:
 *  1. not soft-deleted;
 *  2. `publishState = PUBLISHED` — so a draft *and* an archived garment are both out
 *     (A-13: archiving is how a piece leaves the catalog while keeping its history).
 *
 * The test-render columns are deliberately not consulted; see the file comment.
 */
export function publicGarmentScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string = CATALOG_GARMENT_ALIAS,
): SelectQueryBuilder<T> {
  return qb.andWhere(`${alias}.deletedAt IS NULL`).andWhere(
    `${alias}.publishState = :publicPublishState`,
    {
      publicPublishState: PublishState.PUBLISHED,
    },
  );
}

/**
 * The same rule, applied to a row that has already been loaded.
 *
 * Used as a last filter on everything the catalog is about to return, and asserted
 * exhaustively by the spec across every combination of publish state, test-render
 * state, approval timestamp and soft deletion — the test-render axis is still covered,
 * now asserting that it makes no difference.
 */
export function isPubliclyVisible(garment: Garment): boolean {
  return garment.deletedAt === null && garment.publishState === PublishState.PUBLISHED;
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
