import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';
import { createQueryBuilderSpy } from '@api/modules/users/testing/query-doubles';

import {
  buildArchivedGarment,
  buildGarment,
  buildPublishedGarment,
} from '../../../../test/factories';

import { isPubliclyVisible, onlyPubliclyVisible, publicGarmentScope } from './public-garment.scope';

/**
 * **E-10 — the visibility predicate itself.**
 *
 * > "A test asserts that no garment lacking an approved test render can appear in the
 * > consumer catalog."
 *
 * `CatalogService`'s spec proves every *route* goes through this predicate. This file
 * proves the predicate is right, over every combination of the four columns that
 * decide it — which is cheap, because it is a pure function of a row.
 */
describe('isPubliclyVisible (A-11, A-13, E-10)', () => {
  it('admits a published garment with an approved test render', () => {
    expect(isPubliclyVisible(buildPublishedGarment())).toBe(true);
  });

  describe('refuses anything without an approved test render', () => {
    it.each([
      ['NONE', TestRenderState.NONE],
      ['PENDING', TestRenderState.PENDING],
      ['REJECTED', TestRenderState.REJECTED],
    ])('testRenderState = %s', (_case, testRenderState) => {
      expect(
        isPubliclyVisible(buildPublishedGarment({ testRenderState, testRenderApprovedAt: null })),
      ).toBe(false);
    });

    it('an APPROVED state with no approval timestamp', () => {
      // Both columns, always. The state alone would admit a row left behind by a
      // half-applied migration or a hand-edited database.
      expect(isPubliclyVisible(buildPublishedGarment({ testRenderApprovedAt: null }))).toBe(false);
    });
  });

  describe('refuses anything not in PUBLISHED', () => {
    it('a draft', () => {
      expect(isPubliclyVisible(buildGarment())).toBe(false);
    });

    it('a draft that happens to carry an approved test render', () => {
      expect(
        isPubliclyVisible(
          buildPublishedGarment({ publishState: PublishState.DRAFT, publishedAt: null }),
        ),
      ).toBe(false);
    });

    it('an archived garment, however complete its history (A-13)', () => {
      expect(isPubliclyVisible(buildArchivedGarment({ tryOnCount: 400, loveCount: 380 }))).toBe(
        false,
      );
    });
  });

  it('refuses a soft-deleted garment', () => {
    expect(isPubliclyVisible(buildPublishedGarment({ deletedAt: new Date() }))).toBe(false);
  });

  it('filters a mixed row set down to the visible ones', () => {
    const visible = buildPublishedGarment();
    const rows: Garment[] = [
      buildGarment(),
      buildArchivedGarment(),
      visible,
      buildPublishedGarment({ testRenderState: TestRenderState.PENDING }),
      buildPublishedGarment({ deletedAt: new Date() }),
    ];

    expect(onlyPubliclyVisible(rows)).toEqual([visible]);
  });
});

describe('publicGarmentScope — the SQL half of the same rule', () => {
  it('constrains publish state, both test-render columns and soft deletion', () => {
    const spy = createQueryBuilderSpy<Garment>({ alias: 'garment' });

    publicGarmentScope(spy.builder);

    const sql = spy.sql();
    expect(sql).toContain('garment.deletedAt IS NULL');
    expect(sql).toContain('garment.publishState = :publicPublishState');
    expect(sql).toContain('garment.testRenderState = :publicTestRenderState');
    expect(sql).toContain('garment.testRenderApprovedAt IS NOT NULL');
  });

  it('binds the enum members, not hand-typed strings', () => {
    const spy = createQueryBuilderSpy<Garment>({ alias: 'garment' });

    publicGarmentScope(spy.builder);

    const parameters = spy.argsFor('andWhere').map(([, bound]) => bound);
    expect(parameters).toContainEqual({ publicPublishState: PublishState.PUBLISHED });
    expect(parameters).toContainEqual({ publicTestRenderState: TestRenderState.APPROVED });
  });

  it('honours a caller-supplied alias', () => {
    const spy = createQueryBuilderSpy<Garment>({ alias: 'g' });

    publicGarmentScope(spy.builder, 'g');

    expect(spy.sql()).toContain('g.publishState = :publicPublishState');
  });
});
