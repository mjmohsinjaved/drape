import { createQueryBuilderSpy } from '@api/modules/users/testing/query-doubles';

import {
  ADMIN_ENQUIRY_ITEM_ALIAS,
  adminEnquiryRendersScope,
  FORBIDDEN_ADMIN_RENDER_FRAGMENTS,
} from './admin-enquiry.scope';

import type { EnquiryItem } from '../entities/enquiry-item.entity';

/**
 * **S-10 and §4.24 — the only path from an admin to a render.**
 *
 * > §4.24: "The admin renders query joins `enquiry_items → tryon_results`; there is no
 * > other path from an admin route to a `renders/**` signed URL, and an E-7 test
 * > asserts it."
 *
 * This is that test. It asserts the shape of the query rather than the behaviour of a
 * mapper, because the guarantee is structural: an admin can reach a render **because
 * an `enquiry_items` row exists**, and can reach a photograph never.
 */
describe('adminEnquiryRendersScope (S-10, §4.24)', () => {
  const ENQUIRY_ID = 'e0000000-0000-4000-8000-00000000000e';

  function build(): ReturnType<typeof createQueryBuilderSpy<EnquiryItem>> {
    const spy = createQueryBuilderSpy<EnquiryItem>({ alias: ADMIN_ENQUIRY_ITEM_ALIAS });
    adminEnquiryRendersScope(spy.builder, ENQUIRY_ID);
    return spy;
  }

  it('starts from enquiry_items and joins tryon_results, and joins nothing else', () => {
    const spy = build();

    const joined = [...spy.argsFor('innerJoin'), ...spy.argsFor('leftJoin')].map(([target]) =>
      typeof target === 'function' ? target.name : String(target),
    );

    expect(joined).toEqual(['TryOnResult']);
  });

  it('admits only the render the enquiry item itself names', () => {
    expect(build().sql()).toContain('render.id = item.resultId');
  });

  it('is scoped to one enquiry', () => {
    const spy = build();

    expect(spy.sql()).toContain('item.enquiryId = :enquiryId');
    expect(spy.argsFor('where').map(([, bound]) => bound)).toContainEqual({
      enquiryId: ENQUIRY_ID,
    });
  });

  it('never reaches the photograph the render was made from', () => {
    const sql = build().sql();

    for (const fragment of FORBIDDEN_ADMIN_RENDER_FRAGMENTS) {
      expect(sql).not.toContain(fragment);
    }
  });

  it('selects two render columns and no others', () => {
    const spy = build();

    const selected = [...spy.argsFor('select'), ...spy.argsFor('addSelect')].map(([column]) =>
      String(column),
    );

    expect(selected).toEqual(['item.id', 'render.storageKey', 'render.thumbnailKey']);
  });

  it('excludes a render the consumer has since deleted (C-31)', () => {
    expect(build().sql()).toContain('render.deletedAt IS NULL');
  });
});
