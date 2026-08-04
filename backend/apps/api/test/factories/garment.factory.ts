import { Garment } from '@api/modules/garments/entities/garment.entity';
import { EmbellishmentWeight } from '@api/modules/garments/enums/embellishment-weight.enum';
import { GarmentMode } from '@api/modules/garments/enums/garment-mode.enum';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';

import { FIXED_NOW } from '../setup/time';

import { buildEntity, nextSequence, uuid } from './factory.support';

/**
 * `garments` (§4.13).
 *
 * The default is a **draft**: no approved test render, no quality score, not published. That
 * is deliberate — E-10 asserts no garment lacking an approved test render can reach the
 * consumer catalog, and a factory that defaulted to PUBLISHED would make it trivially easy
 * to write a test that passes for the wrong reason.
 *
 * Use `buildPublishedGarment()` when the test genuinely needs one on the catalog.
 */
export function buildGarment(overrides: Partial<Garment> = {}): Garment {
  const sequence = nextSequence();

  return buildEntity<Garment>(
    Garment,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      sku: `TEST-SKU-${`${sequence}`.padStart(5, '0')}`,
      title: `Test Garment ${sequence}`,
      titleUr: `ٹیسٹ لباس ${sequence}`,
      slug: `test-garment-${sequence}`,
      categoryId: uuid(),

      colors: ['maroon', 'gold'],
      fabric: 'Raw silk',
      embellishmentWeight: EmbellishmentWeight.MEDIUM,
      // decimal(18,2) through decimalTransformer — a number in TS, never a formatted string.
      price: 185_000,
      currency: 'PKR',
      mode: GarmentMode.SALE,
      deposit: null,
      description: 'A test garment. Not real merchandise.',
      descriptionUr: 'ایک ٹیسٹ لباس۔ اصل مال نہیں۔',
      sizes: ['S', 'M', 'L'],
      styleTags: ['bridal', 'traditional'],

      publishState: PublishState.DRAFT,
      publishedAt: null,

      qualityScore: null,
      qualityChecks: null,
      qualityOverriddenBy: null,
      qualityOverriddenAt: null,

      testRenderId: null,
      testRenderState: TestRenderState.NONE,
      testRenderApprovedAt: null,
      approvedBy: null,
      flaggedForReview: false,

      tryOnCount: 0,
      loveCount: 0,
      maybeCount: 0,
      rejectCount: 0,
      enquiryCount: 0,
      failureCount: 0,
      lastTriedAt: null,
    },
    overrides,
  );
}

/**
 * A garment that has cleared the whole A-11 publish gate: approved test render, quality
 * score above the default `quality.minScore` of 70, PUBLISHED.
 */
export function buildPublishedGarment(overrides: Partial<Garment> = {}): Garment {
  return buildGarment({
    publishState: PublishState.PUBLISHED,
    publishedAt: FIXED_NOW,
    qualityScore: 88,
    testRenderId: uuid(),
    testRenderState: TestRenderState.APPROVED,
    testRenderApprovedAt: FIXED_NOW,
    approvedBy: uuid(),
    ...overrides,
  });
}

/** A rental garment. §4.13: `deposit` is required when `mode = RENTAL`. */
export function buildRentalGarment(overrides: Partial<Garment> = {}): Garment {
  return buildGarment({ mode: GarmentMode.RENTAL, deposit: 45_000, ...overrides });
}

/** An archived garment — still carries its analytics history (A-13), never in the catalog. */
export function buildArchivedGarment(overrides: Partial<Garment> = {}): Garment {
  return buildPublishedGarment({ publishState: PublishState.ARCHIVED, ...overrides });
}
