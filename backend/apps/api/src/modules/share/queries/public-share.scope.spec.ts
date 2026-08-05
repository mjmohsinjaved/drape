import type { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { createQueryBuilderSpy } from '@api/modules/users/testing/query-doubles';

import { Verdict } from '../../shortlist/enums/verdict.enum';

import {
  FORBIDDEN_SHARE_FRAGMENTS,
  publicShareScope,
  SHARED_ITEM_ALIAS,
} from './public-share.scope';

/**
 * **C-33's three exclusions, asserted against the query itself.**
 *
 * > "They see only the renders on that shortlist … They cannot see her photo, her
 * > other renders, or her contact details."
 *
 * These are the tests that matter most in the module. They do not check that a mapper
 * happens not to copy a field across — they check that **the query never loads it**,
 * which is a property no future edit to a mapper, a DTO or a controller can undo.
 *
 * `createQueryBuilderSpy` records every string the query was built from: SQL
 * fragments, selected columns, join conditions and the names of the entity classes
 * passed as join targets. So "this query never mentions `person_photos`" is a single
 * expectation over the whole thing rather than a hopeful reading of the source.
 */
describe('publicShareScope — the recipient projection (C-33, §4.21)', () => {
  const OWNER_ID = 'c0000000-0000-4000-8000-00000000000c';

  function build(): ReturnType<typeof createQueryBuilderSpy<ShortlistItem>> {
    const spy = createQueryBuilderSpy<ShortlistItem>({ alias: SHARED_ITEM_ALIAS });
    publicShareScope(spy.builder, OWNER_ID);
    return spy;
  }

  describe('exclusion 1 — her photo', () => {
    it('never names the photo table, the relation or the column', () => {
      const sql = build().sql();

      expect(sql).not.toContain('person_photos');
      expect(sql).not.toContain('personPhoto');
      expect(sql).not.toContain('PersonPhoto');
    });

    it('joins exactly three tables, and none of them is the photo table', () => {
      const spy = build();

      const joined = [...spy.argsFor('innerJoin'), ...spy.argsFor('leftJoin')].map(([target]) =>
        typeof target === 'function' ? target.name : String(target),
      );

      expect(joined).toEqual(['Garment', 'Category', 'TryOnResult']);
    });
  });

  describe('exclusion 2 — her other renders', () => {
    it('admits only the render the shortlist row itself names', () => {
      const sql = build().sql();

      expect(sql).toContain('render.id = item.latestResultId');
    });

    it('additionally requires the render to belong to the same account', () => {
      // Without this, a tampered or stale `latestResultId` would be a way to pull
      // another consumer's render onto a share page.
      expect(build().sql()).toContain('render.userId = item.userId');
    });

    it('excludes admin test renders', () => {
      expect(build().sql()).toContain('render.isTestRender = false');
    });

    it('selects the thumbnail key and never the full render key', () => {
      const sql = build().sql();

      expect(sql).toContain('render.thumbnailKey');
      // A `renders/**` URL is `sub`-scoped to its owner's session (§3.4), which a
      // recipient does not have — so the key is not merely unused here, it is unusable.
      expect(sql).not.toContain('storageKey');
    });
  });

  describe('exclusion 3 — her contact details', () => {
    it('never joins the account row', () => {
      const spy = build();

      const joined = [...spy.argsFor('innerJoin'), ...spy.argsFor('leftJoin')].map(([target]) =>
        typeof target === 'function' ? target.name : String(target),
      );

      expect(joined).not.toContain('User');
    });

    it('selects no contact column', () => {
      const sql = build().sql();

      expect(sql).not.toContain('contactEmail');
      expect(sql).not.toContain('contactPhone');
      expect(sql).not.toContain('passwordHash');
    });

    it('selects no note of hers — the notes are for her, not for the group', () => {
      expect(build().sql()).not.toContain('item.note');
    });
  });

  it('carries none of the forbidden fragments at all', () => {
    // The same three exclusions as one assertion, so a new column added to the
    // projection is checked against the whole list rather than against the one
    // property whoever added it happened to think about.
    const sql = build().sql();

    for (const fragment of FORBIDDEN_SHARE_FRAGMENTS) {
      expect(sql).not.toContain(fragment);
    }
  });

  describe('scoping', () => {
    it('is scoped to one owner', () => {
      const spy = build();

      expect(spy.sql()).toContain('item.userId = :shareOwnerId');
      expect(spy.argsFor('where').map(([, bound]) => bound)).toContainEqual({
        shareOwnerId: OWNER_ID,
      });
    });

    it('shows Love it and Maybe, and never a rejection (§4.20)', () => {
      const parameters = build()
        .argsFor('andWhere')
        .map(([, bound]) => bound);

      expect(parameters).toContainEqual({
        shareVerdicts: [Verdict.LOVE_IT, Verdict.MAYBE],
      });
      expect(JSON.stringify(parameters)).not.toContain(Verdict.NOT_FOR_ME);
    });

    it('excludes soft-deleted rows on both sides of every join', () => {
      const sql = build().sql();

      expect(sql).toContain('item.deletedAt IS NULL');
      expect(sql).toContain('garment.deletedAt IS NULL');
      expect(sql).toContain('render.deletedAt IS NULL');
    });

    it('orders by the rank she chose', () => {
      const spy = build();

      expect(spy.argsFor('orderBy')).toEqual([['item.rank', 'ASC']]);
      expect(spy.argsFor('addOrderBy')).toEqual([['item.createdAt', 'ASC']]);
    });
  });
});
