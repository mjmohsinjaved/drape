import { ErrorCode } from '@library/common';

import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';

import type { Garment } from '../entities/garment.entity';

/**
 * **The publish advisories — PRD A-10, A-11, ARCHITECTURE §4.13.**
 *
 * ### These no longer block anything
 *
 * This was a gate: it returned the first unmet precondition and `publish()` threw it.
 * It now returns **every** unmet condition and `publish()` reports them without
 * refusing. An admin who wants a piece in the catalog gets it in the catalog; the
 * conditions are advice, recorded in the audit trail, not a veto.
 *
 * **This is a deliberate departure from A-11 and E-10**, which say no garment reaches
 * the consumer catalog without an approved test render, and it was asked for
 * explicitly. The consequence is worth stating plainly: a garment can now be published
 * with no try-on source, in which case it appears in the catalog and fails when a
 * consumer tries it on, because there is no image to send upstream. Nothing here
 * prevents that any more.
 *
 * The state machine is untouched. `isAllowedPublishTransition` still governs which
 * transitions are legal, and publishing something already published is still refused —
 * that is a contradiction, not a quality opinion.
 *
 * Kept as a **pure function**, which is what makes it testable exhaustively over every
 * combination of `testRenderState`, `testRenderApprovedAt`, quality score and override
 * with no repository, no container and no mocking.
 */

/** Everything the evaluation needs that is not on the row itself. */
export interface PublishGateInput {
  readonly garment: Garment;
  /** Whether a `garment_images` row is marked `isTryOnSource` (A-9, §4.14). */
  readonly hasTryOnSource: boolean;
  /** `quality.minScore` from `SettingsService` (A-10). */
  readonly minQualityScore: number;
}

/** The publish transitions §4.13 permits. Anything else is `INVALID_PUBLISH_TRANSITION`. */
export const ALLOWED_PUBLISH_TRANSITIONS: Readonly<Record<PublishState, readonly PublishState[]>> =
  {
    [PublishState.DRAFT]: [PublishState.PUBLISHED],
    [PublishState.PUBLISHED]: [PublishState.ARCHIVED, PublishState.DRAFT],
    // "ARCHIVED → PUBLISHED (re-validated)" — re-validated means this gate runs again,
    // which it does, because publish() calls it on every transition into PUBLISHED.
    [PublishState.ARCHIVED]: [PublishState.PUBLISHED],
  };

export function isAllowedPublishTransition(from: PublishState, to: PublishState): boolean {
  return ALLOWED_PUBLISH_TRANSITIONS[from].includes(to);
}

/**
 * `true` when the garment carries an **approved** test render (A-11).
 *
 * Both columns are required. `testRenderState` alone would let a row approved by a
 * half-applied migration or a hand-edited database through; the timestamp is the
 * evidence that an admin actually approved it, and §4.13 stores both for that reason.
 *
 * The `catalog` module's public visibility predicate applies the same two conditions
 * in SQL. They are asserted equivalent by test, because "approved" meaning one thing
 * at publish time and another at browse time is precisely the gap E-10 exists to
 * close.
 */
export function hasApprovedTestRender(garment: Garment): boolean {
  return (
    garment.testRenderState === TestRenderState.APPROVED && garment.testRenderApprovedAt !== null
  );
}

/** `true` when an admin has recorded an A-10 override on this garment. */
export function hasQualityOverride(garment: Garment): boolean {
  return garment.qualityOverriddenBy !== null && garment.qualityOverriddenAt !== null;
}

/**
 * Every unmet publishing condition, in the order §4.13 states them.
 *
 * **All of them, not the first one.** A gate could stop at the first refusal because
 * the caller could only act on one thing at a time anyway. Advice is different: an
 * admin about to publish a piece with no source image *and* a poor score should be
 * told both at once, not discover the second after fixing the first.
 *
 * @returns the codes naming what is unmet. Empty means the garment meets every
 * recommendation. Nothing here prevents publishing either way.
 */
export function evaluatePublishAdvisories(input: PublishGateInput): readonly ErrorCode[] {
  const { garment, hasTryOnSource, minQualityScore } = input;
  const advisories: ErrorCode[] = [];

  // A-11. Still reported first: it is the most useful thing to tell an admin who has
  // published nothing yet, and the render is the only evidence the piece works at all.
  if (!hasApprovedTestRender(garment)) {
    advisories.push(ErrorCode.TEST_RENDER_REQUIRED);
  }

  // A-9 / §4.13: the file sent upstream as `garment_image`. Publishing without one puts
  // a garment in the catalog that cannot be tried on — the failure surfaces at
  // generation time instead, which is the cost of not blocking here.
  if (!hasTryOnSource) {
    advisories.push(ErrorCode.TRYON_SOURCE_REQUIRED);
  }

  // A-10. An unscored garment counts as below threshold: the absence of a quality
  // verdict is not evidence of a good photograph. An override is an admin saying she
  // has looked and is content, so it silences the advisory.
  const belowThreshold = garment.qualityScore === null || garment.qualityScore < minQualityScore;
  if (belowThreshold && !hasQualityOverride(garment)) {
    advisories.push(ErrorCode.QUALITY_OVERRIDE_REQUIRED);
  }

  return advisories;
}
