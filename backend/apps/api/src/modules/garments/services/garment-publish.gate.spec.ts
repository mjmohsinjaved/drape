import { ErrorCode } from '@library/common';

import {
  buildArchivedGarment,
  buildGarment,
  buildPublishedGarment,
} from '../../../../test/factories';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';

import {
  evaluatePublishGate,
  hasApprovedTestRender,
  hasQualityOverride,
  isAllowedPublishTransition,
} from './garment-publish.gate';

import type { Garment } from '../entities/garment.entity';

/**
 * **The publish gate — PRD A-11, A-10, E-10.**
 *
 * > E-10: "A test asserts that no garment lacking an approved test render can appear
 * > in the consumer catalog."
 *
 * The catalog half of E-10 lives in `modules/catalog`. This is the other half: the
 * gate that stands between a garment and `PUBLISHED`, exercised exhaustively because
 * it is a pure function and there is therefore no excuse not to.
 */
describe('evaluatePublishGate (A-11, A-10)', () => {
  const MIN_SCORE = 70;

  /** A garment that clears every gate, so each case below changes exactly one thing. */
  function ready(overrides: Partial<Garment> = {}): Garment {
    return buildPublishedGarment({
      publishState: PublishState.DRAFT,
      publishedAt: null,
      qualityScore: 88,
      ...overrides,
    });
  }

  it('permits a garment that has cleared every precondition', () => {
    expect(
      evaluatePublishGate({ garment: ready(), hasTryOnSource: true, minQualityScore: MIN_SCORE }),
    ).toBeNull();
  });

  describe('A-11 — the test-render gate', () => {
    it.each([
      ['no test render at all', TestRenderState.NONE, null],
      ['a pending test render', TestRenderState.PENDING, null],
      ['a rejected test render', TestRenderState.REJECTED, null],
      ['an APPROVED state with no approval timestamp', TestRenderState.APPROVED, null],
    ])('refuses %s with TEST_RENDER_REQUIRED', (_case, testRenderState, testRenderApprovedAt) => {
      const garment = ready({
        testRenderState,
        testRenderApprovedAt: testRenderApprovedAt as Date | null,
      });

      expect(
        evaluatePublishGate({ garment, hasTryOnSource: true, minQualityScore: MIN_SCORE }),
      ).toBe(ErrorCode.TEST_RENDER_REQUIRED);
    });

    it('refuses before it even looks at the quality score', () => {
      // A garment failing both gates reports the test render, which is the more
      // fundamental failure and the more useful thing to tell an admin.
      const garment = ready({
        testRenderState: TestRenderState.NONE,
        testRenderApprovedAt: null,
        qualityScore: 10,
      });

      expect(
        evaluatePublishGate({ garment, hasTryOnSource: false, minQualityScore: MIN_SCORE }),
      ).toBe(ErrorCode.TEST_RENDER_REQUIRED);
    });

    it('cannot be satisfied by a quality override', () => {
      const garment = ready({
        testRenderState: TestRenderState.REJECTED,
        testRenderApprovedAt: null,
        qualityOverriddenBy: 'a0000000-0000-4000-8000-00000000000a',
        qualityOverriddenAt: new Date(),
      });

      expect(
        evaluatePublishGate({ garment, hasTryOnSource: true, minQualityScore: MIN_SCORE }),
      ).toBe(ErrorCode.TEST_RENDER_REQUIRED);
    });
  });

  describe('A-9 — the try-on source image', () => {
    it('refuses a garment with no try-on source', () => {
      expect(
        evaluatePublishGate({
          garment: ready(),
          hasTryOnSource: false,
          minQualityScore: MIN_SCORE,
        }),
      ).toBe(ErrorCode.TRYON_SOURCE_REQUIRED);
    });
  });

  describe('A-10 — the quality gate', () => {
    it('refuses a score below the threshold with QUALITY_OVERRIDE_REQUIRED', () => {
      expect(
        evaluatePublishGate({
          garment: ready({ qualityScore: 69 }),
          hasTryOnSource: true,
          minQualityScore: MIN_SCORE,
        }),
      ).toBe(ErrorCode.QUALITY_OVERRIDE_REQUIRED);
    });

    it('treats an unscored garment as below the threshold', () => {
      expect(
        evaluatePublishGate({
          garment: ready({ qualityScore: null }),
          hasTryOnSource: true,
          minQualityScore: MIN_SCORE,
        }),
      ).toBe(ErrorCode.QUALITY_OVERRIDE_REQUIRED);
    });

    it('accepts a score exactly on the threshold', () => {
      expect(
        evaluatePublishGate({
          garment: ready({ qualityScore: MIN_SCORE }),
          hasTryOnSource: true,
          minQualityScore: MIN_SCORE,
        }),
      ).toBeNull();
    });

    it('permits a low score once an override has been recorded', () => {
      const garment = ready({
        qualityScore: 12,
        qualityOverriddenBy: 'a0000000-0000-4000-8000-00000000000a',
        qualityOverriddenAt: new Date(),
      });

      expect(
        evaluatePublishGate({ garment, hasTryOnSource: true, minQualityScore: MIN_SCORE }),
      ).toBeNull();
    });

    it('ignores a half-written override', () => {
      const garment = ready({
        qualityScore: 12,
        qualityOverriddenBy: 'a0000000-0000-4000-8000-00000000000a',
        qualityOverriddenAt: null,
      });

      expect(
        evaluatePublishGate({ garment, hasTryOnSource: true, minQualityScore: MIN_SCORE }),
      ).toBe(ErrorCode.QUALITY_OVERRIDE_REQUIRED);
    });
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

  it('re-validates an archived garment on its way back to published', () => {
    // A-13 archiving keeps the row and its history, so an archived garment can still
    // be missing an approved test render by the time somebody re-publishes it.
    const archived = buildArchivedGarment({
      testRenderState: TestRenderState.REJECTED,
      testRenderApprovedAt: null,
    });

    expect(isAllowedPublishTransition(archived.publishState, PublishState.PUBLISHED)).toBe(true);
    expect(
      evaluatePublishGate({ garment: archived, hasTryOnSource: true, minQualityScore: 70 }),
    ).toBe(ErrorCode.TEST_RENDER_REQUIRED);
  });
});
