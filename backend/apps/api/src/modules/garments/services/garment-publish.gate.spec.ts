import { ErrorCode } from '@library/common';

import {
  buildArchivedGarment,
  buildGarment,
  buildPublishedGarment,
} from '../../../../test/factories';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';

import {
  evaluatePublishAdvisories,
  hasApprovedTestRender,
  hasQualityOverride,
  isAllowedPublishTransition,
} from './garment-publish.gate';

import type { Garment } from '../entities/garment.entity';

/**
 * **The publish advisories — PRD A-11, A-10.**
 *
 * These used to be gates and E-10 asserted the strongest of them by test: "no garment
 * lacking an approved test render can appear in the consumer catalog." That is no
 * longer true and was changed deliberately — publishing is now unconditional and the
 * conditions are advice. What is asserted here is that the advice is still *complete
 * and correct*, because it is now the only thing standing between an admin and a
 * catalog entry that cannot be tried on.
 *
 * Exercised exhaustively because it is a pure function and there is no excuse not to.
 */
describe('evaluatePublishAdvisories (A-11, A-10)', () => {
  const MIN_SCORE = 70;

  /** A garment that meets every recommendation, so each case changes exactly one thing. */
  function ready(overrides: Partial<Garment> = {}): Garment {
    return buildPublishedGarment({
      publishState: PublishState.DRAFT,
      publishedAt: null,
      qualityScore: 88,
      ...overrides,
    });
  }

  it('reports nothing for a garment that has met every recommendation', () => {
    expect(
      evaluatePublishAdvisories({
        garment: ready(),
        hasTryOnSource: true,
        minQualityScore: MIN_SCORE,
      }),
    ).toEqual([]);
  });

  describe('A-11 — the test render', () => {
    it.each([
      ['no test render at all', TestRenderState.NONE, null],
      ['a pending test render', TestRenderState.PENDING, null],
      ['a rejected test render', TestRenderState.REJECTED, null],
      ['an APPROVED state with no approval timestamp', TestRenderState.APPROVED, null],
    ])('reports %s as TEST_RENDER_REQUIRED', (_case, testRenderState, testRenderApprovedAt) => {
      const garment = ready({
        testRenderState,
        testRenderApprovedAt: testRenderApprovedAt as Date | null,
      });

      expect(
        evaluatePublishAdvisories({ garment, hasTryOnSource: true, minQualityScore: MIN_SCORE }),
      ).toEqual([ErrorCode.TEST_RENDER_REQUIRED]);
    });

    it('is not silenced by a quality override', () => {
      const garment = ready({
        testRenderState: TestRenderState.REJECTED,
        testRenderApprovedAt: null,
        qualityOverriddenBy: 'a0000000-0000-4000-8000-00000000000a',
        qualityOverriddenAt: new Date(),
      });

      expect(
        evaluatePublishAdvisories({ garment, hasTryOnSource: true, minQualityScore: MIN_SCORE }),
      ).toEqual([ErrorCode.TEST_RENDER_REQUIRED]);
    });
  });

  describe('A-9 — the try-on source image', () => {
    it('reports a garment with no try-on source', () => {
      expect(
        evaluatePublishAdvisories({
          garment: ready(),
          hasTryOnSource: false,
          minQualityScore: MIN_SCORE,
        }),
      ).toEqual([ErrorCode.TRYON_SOURCE_REQUIRED]);
    });
  });

  describe('A-10 — the quality score', () => {
    it('reports a score below the threshold as QUALITY_OVERRIDE_REQUIRED', () => {
      expect(
        evaluatePublishAdvisories({
          garment: ready({ qualityScore: 69 }),
          hasTryOnSource: true,
          minQualityScore: MIN_SCORE,
        }),
      ).toEqual([ErrorCode.QUALITY_OVERRIDE_REQUIRED]);
    });

    it('treats an unscored garment as below the threshold', () => {
      expect(
        evaluatePublishAdvisories({
          garment: ready({ qualityScore: null }),
          hasTryOnSource: true,
          minQualityScore: MIN_SCORE,
        }),
      ).toEqual([ErrorCode.QUALITY_OVERRIDE_REQUIRED]);
    });

    it('says nothing about a score exactly on the threshold', () => {
      expect(
        evaluatePublishAdvisories({
          garment: ready({ qualityScore: MIN_SCORE }),
          hasTryOnSource: true,
          minQualityScore: MIN_SCORE,
        }),
      ).toEqual([]);
    });

    it('is silenced by a recorded override', () => {
      const garment = ready({
        qualityScore: 12,
        qualityOverriddenBy: 'a0000000-0000-4000-8000-00000000000a',
        qualityOverriddenAt: new Date(),
      });

      expect(
        evaluatePublishAdvisories({ garment, hasTryOnSource: true, minQualityScore: MIN_SCORE }),
      ).toEqual([]);
    });

    it('ignores a half-written override', () => {
      const garment = ready({
        qualityScore: 12,
        qualityOverriddenBy: 'a0000000-0000-4000-8000-00000000000a',
        qualityOverriddenAt: null,
      });

      expect(
        evaluatePublishAdvisories({ garment, hasTryOnSource: true, minQualityScore: MIN_SCORE }),
      ).toEqual([ErrorCode.QUALITY_OVERRIDE_REQUIRED]);
    });
  });

  /**
   * The reason advisories are a list rather than the first failure: an admin fixing one
   * thing at a time is an admin making three round trips.
   */
  it('reports every unmet condition at once, in §4.13 order', () => {
    const garment = ready({
      testRenderState: TestRenderState.NONE,
      testRenderApprovedAt: null,
      qualityScore: 10,
    });

    expect(
      evaluatePublishAdvisories({ garment, hasTryOnSource: false, minQualityScore: MIN_SCORE }),
    ).toEqual([
      ErrorCode.TEST_RENDER_REQUIRED,
      ErrorCode.TRYON_SOURCE_REQUIRED,
      ErrorCode.QUALITY_OVERRIDE_REQUIRED,
    ]);
  });
});

describe('hasApprovedTestRender', () => {
  it('requires both the state and the approval timestamp', () => {
    expect(hasApprovedTestRender(buildPublishedGarment())).toBe(true);
    expect(hasApprovedTestRender(buildPublishedGarment({ testRenderApprovedAt: null }))).toBe(
      false,
    );
    expect(
      hasApprovedTestRender(buildPublishedGarment({ testRenderState: TestRenderState.PENDING })),
    ).toBe(false);
    expect(hasApprovedTestRender(buildGarment())).toBe(false);
  });
});

describe('hasQualityOverride', () => {
  it('requires both override columns', () => {
    expect(hasQualityOverride(buildGarment())).toBe(false);
    expect(
      hasQualityOverride(
        buildGarment({ qualityOverriddenBy: 'a', qualityOverriddenAt: new Date() }),
      ),
    ).toBe(true);
    expect(hasQualityOverride(buildGarment({ qualityOverriddenBy: 'a' }))).toBe(false);
  });
});

describe('isAllowedPublishTransition (§4.13)', () => {
  it('permits exactly the four transitions §4.13 lists', () => {
    expect(isAllowedPublishTransition(PublishState.DRAFT, PublishState.PUBLISHED)).toBe(true);
    expect(isAllowedPublishTransition(PublishState.PUBLISHED, PublishState.ARCHIVED)).toBe(true);
    expect(isAllowedPublishTransition(PublishState.PUBLISHED, PublishState.DRAFT)).toBe(true);
    expect(isAllowedPublishTransition(PublishState.ARCHIVED, PublishState.PUBLISHED)).toBe(true);
  });

  it('refuses everything else', () => {
    expect(isAllowedPublishTransition(PublishState.DRAFT, PublishState.ARCHIVED)).toBe(false);
    expect(isAllowedPublishTransition(PublishState.ARCHIVED, PublishState.DRAFT)).toBe(false);
    expect(isAllowedPublishTransition(PublishState.DRAFT, PublishState.DRAFT)).toBe(false);
    expect(isAllowedPublishTransition(PublishState.PUBLISHED, PublishState.PUBLISHED)).toBe(false);
  });

  it('re-evaluates an archived garment on its way back to published', () => {
    // A-13 archiving keeps the row and its history, so an archived garment can still
    // be missing an approved test render by the time somebody re-publishes it. The
    // transition is legal and the advisory is raised — it no longer stops the publish.
    const archived = buildArchivedGarment({
      testRenderState: TestRenderState.REJECTED,
      testRenderApprovedAt: null,
    });

    expect(isAllowedPublishTransition(archived.publishState, PublishState.PUBLISHED)).toBe(true);
    expect(
      evaluatePublishAdvisories({ garment: archived, hasTryOnSource: true, minQualityScore: 70 }),
    ).toEqual([ErrorCode.TEST_RENDER_REQUIRED]);
  });
});
