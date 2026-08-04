import { In } from 'typeorm';

import { Category } from '@api/modules/categories/entities/category.entity';

import type { SeedContext, SeedOutcome, Seeder } from './seeder.contract';

/**
 * The example categories named in PRD A-4, in the order they should appear on the browse
 * screen (A-6: `position` drives consumer ordering).
 *
 * These are a *starting point*, not a fixed taxonomy — an admin renames, reorders and
 * archives them through `/admin/categories`. The seeder therefore matches on `slug` and
 * leaves any existing row exactly as it is, including its position: re-running the seed
 * after an admin has reordered the browse screen must not undo that.
 *
 * All nine are top level. A-5 allows one level of sub-category, and none of the examples
 * calls for one.
 */

interface CategorySeed {
  readonly name: string;
  readonly nameUr: string;
  readonly slug: string;
  readonly position: number;
}

/** Exported so `scripts/db-seed-check.ts` verifies against this list, not a second copy. */
export const CATEGORY_SEEDS: readonly CategorySeed[] = [
  { name: 'Bridal Lehenga', nameUr: 'دلہن لہنگا', slug: 'bridal-lehenga', position: 0 },
  { name: 'Sharara', nameUr: 'شرارہ', slug: 'sharara', position: 1 },
  { name: 'Gharara', nameUr: 'غرارہ', slug: 'gharara', position: 2 },
  { name: 'Saree', nameUr: 'ساڑھی', slug: 'saree', position: 3 },
  { name: 'Anarkali', nameUr: 'انارکلی', slug: 'anarkali', position: 4 },
  { name: 'Walima', nameUr: 'ولیمہ', slug: 'walima', position: 5 },
  { name: 'Mehndi', nameUr: 'مہندی', slug: 'mehndi', position: 6 },
  { name: 'Nikkah', nameUr: 'نکاح', slug: 'nikkah', position: 7 },
  { name: 'Groom', nameUr: 'دولہا', slug: 'groom', position: 8 },
];

export const categoriesSeeder: Seeder = {
  name: 'categories',

  async run(context: SeedContext): Promise<SeedOutcome> {
    const repository = context.manager.getRepository(Category);

    // Matches `UQ_categories_slug UNIQUE ("slug") WHERE "deletedAt" IS NULL` (§4.12).
    const existing = await repository.find({
      select: { slug: true },
      where: { slug: In(CATEGORY_SEEDS.map((seed) => seed.slug)) },
    });
    const existingSlugs = new Set(existing.map((row) => row.slug));

    const missing = CATEGORY_SEEDS.filter((seed) => !existingSlugs.has(seed.slug));
    if (missing.length > 0) {
      await repository.save(
        missing.map((seed) =>
          repository.create({
            name: seed.name,
            nameUr: seed.nameUr,
            slug: seed.slug,
            parentId: null,
            coverImageKey: null,
            position: seed.position,
            archived: false,
            archivedAt: null,
            // Denormalised counter (§4.12), maintained on publish-state change. A new
            // category holds nothing, so the A-7 delete guard reads zero.
            publishedGarmentCount: 0,
          }),
        ),
      );
    }

    return {
      created: missing.length,
      skipped: existingSlugs.size,
      notes:
        missing.length > 0
          ? ['Cover images are unset — an admin adds them from /admin/categories (A-6).']
          : undefined,
    };
  },
};
