/**
 * URL slugs for `garments.slug` (§4.13).
 *
 * ASCII-only and derived from the English `title`: `titleUr` is Urdu, and a slug
 * derived from it would be a percent-encoded string nobody can read, share or type.
 *
 * `categories` keeps its own copy of this pair. That is intentional — §2.9 rule 5
 * keeps modules out of each other's internals, and the two column ceilings differ
 * (200 here, 96 there).
 */

/** `garments.slug` is `varchar(200)` (§4.13). */
export const MAX_GARMENT_SLUG_LENGTH = 200;

/** `"Zarrin Bridal Lehenga"` → `"zarrin-bridal-lehenga"`. Empty when nothing is sluggable. */
export function slugify(input: string, maxLength: number = MAX_GARMENT_SLUG_LENGTH): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/** The nth candidate for a taken stem: `zarrin`, `zarrin-2`, `zarrin-3`, … */
export function suffixedSlug(
  stem: string,
  attempt: number,
  maxLength: number = MAX_GARMENT_SLUG_LENGTH,
): string {
  if (attempt <= 1) {
    return stem.slice(0, maxLength);
  }

  const suffix = `-${attempt}`;
  return `${stem.slice(0, maxLength - suffix.length).replace(/-+$/g, '')}${suffix}`;
}
