import { ErrorCode } from '@library/common';

import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';

import type { Garment } from '../entities/garment.entity';

/**
 * **The publish gate — PRD A-11 and A-10, ARCHITECTURE §4.13, E-10.**
 *
 * > A-11: "No garment reaches the consumer catalog without an approved test render."
 * > E-10: "A test asserts that no garment lacking an approved test render can appear
 * > in the consumer catalog."
 *
 * Kept as a **pure function** rather than a method for two reasons. It is the rule
 * that must be impossible to bypass, so it is testable exhaustively over every
 * combination of `testRenderState`, `testRenderApprovedAt`, quality score and
 * override — no repository, no container, no mocking. And the same function answers
 * both questions the API asks: "may this publish proceed?" (the service throws on a
 * non-null result) and "would it?" (`GarmentResponseDto.publishable`, so the console
 * can disable the button rather than offer an action that will be refused).
 *
 * There is exactly one caller-visible consequence of a `null` return: publishing is
 * permitted. Everything else is a refusal with the §2.4 code that names the reason.
 */

/** Everything the gate needs that is not on the row itself. */
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
 * Evaluates the gate.
 *
 * @returns `null` when the garment may be published, or the `ErrorCode` naming the
 * first unmet precondition. The order is the order §4.13 states the preconditions in,
 * most fundamental first: no test render, no source image, then quality.
 */
export function evaluatePublishGate(input: PublishGateInput): ErrorCode | null {
  const { garment, hasTryOnSource, minQualityScore } = input;

  // A-11 / E-10. First, because it is the one that must never be bypassable, and
  // because it is the most useful thing to tell an admin who has published nothing yet.
  if (!hasApprovedTestRender(garment)) {
    return ErrorCode.TEST_RENDER_REQUIRED;
  }

  // A-9 / §4.13: the file sent upstream as `garment_image`. A garment with an approved
  // render but no source row has had its source deleted since.
  if (!hasTryOnSource) {
    return ErrorCode.TRYON_SOURCE_REQUIRED;
  }

  // A-10. An unscored garment counts as below threshold: the absence of a quality
  // verdict is not evidence of a good photograph, and treating it as one would make
  // "publish before the validator runs" a way around the threshold.
  if (hasQualityOverride(garment)) {
    return null;
  }
  if (garment.qualityScore === null || garment.qualityScore < minQualityScore) {
    return ErrorCode.QUALITY_OVERRIDE_REQUIRED;
  }

  return null;
}
