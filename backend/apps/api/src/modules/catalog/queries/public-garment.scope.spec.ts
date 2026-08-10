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
 * **The visibility predicate itself.**
 *
 * `CatalogService`'s spec proves every *route* goes through this predicate. This file
 * proves the predicate is right, over every combination of the columns that could
 * decide it — which is cheap, because it is a pure function of a row.
 *
 * The test-render axis is still exercised in full. It no longer changes the answer, and
 * saying so explicitly is the point: these cases are what stop the A-11 gate returning
 * by accident in some later refactor.
 */
describe('isPubliclyVisible (A-13)', () => {
  it('admits a published garment with an approved test render', () => {
    expect(isPubliclyVisible(buildPublishedGarment())).toBe(true);
  });

  describe('ignores the test render entirely', () => {
    it.each([
      ['NONE', TestRenderState.NONE],
      ['PENDING', TestRenderState.PENDING],
      ['REJECTED', TestRenderState.REJECTED],
    ])('admits a published garment with testRenderState = %s', (_case, testRenderState) => {
      expect(
        isPubliclyVisible(buildPublishedGarment({ testRenderState, testRenderApprovedAt: null })),
      ).toBe(true);
    });

    it('admits an APPROVED state with no approval timestamp', () => {
      expect(isPubliclyVisible(buildPublishedGarment({ testRenderApprovedAt: null }))).toBe(true);
    });

    it('gives the same answer for every state/timestamp combination', () => {
      const answers = [
        TestRenderState.NONE,
        TestRenderState.PENDING,
        TestRenderState.REJECTED,
        TestRenderState.APPROVED,
      ].flatMap((testRenderState) =>
        [null, new Date()].map((testRenderApprovedAt) =>
          isPubliclyVisible(buildPublishedGarment({ testRenderState, testRenderApprovedAt })),
        ),
      );

      expect(new Set(answers)).toEqual(new Set([true]));
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
    const alsoVisible = buildPublishedGarment({ testRenderState: TestRenderState.PENDING });
    const rows: Garment[] = [
      buildGarment(),
      buildArchivedGarment(),
      visible,
      alsoVisible,
      buildPublishedGarment({ deletedAt: new Date() }),
    ];

    expect(onlyPubliclyVisible(rows)).toEqual([visible, alsoVisible]);
  });
});

describe('publicGarmentScope — the SQL half of the same rule', () => {
  it('constrains publish state and soft deletion', () => {
    const spy = createQueryBuilderSpy<Garment>({ alias: 'garment' });

    publicGarmentScope(spy.builder);

    const sql = spy.sql();
    expect(sql).toContain('garment.deletedAt IS NULL');
    expect(sql).toContain('garment.publishState = :publicPublishState');
  });

  it('does not constrain either test-render column', () => {
    // The SQL half and the row half have to agree. If a later change puts the A-11 gate
    // back into one of them and not the other, "published" means two different things
    // depending on which route you arrived by — which is the gap the two-layer design
    // exists to close, in whichever direction the rule points.
    const spy = createQueryBuilderSpy<Garment>({ alias: 'garment' });

    publicGarmentScope(spy.builder);

    const sql = spy.sql();
    expect(sql).not.toContain('testRenderState');
    expect(sql).not.toContain('testRenderApprovedAt');
  });

  it('binds the enum member, not a hand-typed string', () => {
    const spy = createQueryBuilderSpy<Garment>({ alias: 'garment' });

    publicGarmentScope(spy.builder);

    const parameters = spy.argsFor('andWhere').map(([, bound]) => bound);
    expect(parameters).toContainEqual({ publicPublishState: PublishState.PUBLISHED });
  });

  it('honours a caller-supplied alias', () => {
    const spy = createQueryBuilderSpy<Garment>({ alias: 'g' });

    publicGarmentScope(spy.builder, 'g');

    expect(spy.sql()).toContain('g.publishState = :publicPublishState');
  });
});
