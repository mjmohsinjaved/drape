import { Category } from '@api/modules/categories/entities/category.entity';

import { FIXED_NOW } from '../setup/time';

import { buildEntity, nextSequence, uuid } from './factory.support';

/**
 * `categories` (§4.12). Top level and unarchived by default.
 *
 * `coverImageKey` is null rather than a made-up key: a key that does not correspond to a
 * stored object is worse than no key, because the signed-URL path would happily sign it.
 */
export function buildCategory(overrides: Partial<Category> = {}): Category {
  const sequence = nextSequence();

  return buildEntity<Category>(
    Category,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      name: `Test Category ${sequence}`,
      nameUr: `ٹیسٹ زمرہ ${sequence}`,
      slug: `test-category-${sequence}`,
      parentId: null,
      coverImageKey: null,
      position: sequence,
      archived: false,
      archivedAt: null,
      // Denormalised, maintained on publish-state change. The A-7 delete guard reads it.
      publishedGarmentCount: 0,
    },
    overrides,
  );
}

/**
 * A one-level sub-category (A-5). A category with a `parentId` may not itself be a parent —
 * the service enforces that with `CATEGORY_DEPTH_EXCEEDED`.
 */
export function buildSubCategory(parent: Category, overrides: Partial<Category> = {}): Category {
  return buildCategory({ parentId: parent.id, ...overrides });
}

/** An archived category. A-7: archiving is the only way out for one holding published garments. */
export function buildArchivedCategory(overrides: Partial<Category> = {}): Category {
  return buildCategory({ archived: true, archivedAt: FIXED_NOW, ...overrides });
}
