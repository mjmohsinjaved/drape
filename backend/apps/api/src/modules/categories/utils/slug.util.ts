/**
 * URL slugs for `categories.slug` (§4.12).
 *
 * Deliberately ASCII-only. `nameUr` is Urdu, and a slug derived from it would be a
 * percent-encoded string nobody can read, share or type — so the slug always comes
 * from the English `name`, and a name with no ASCII letters at all falls back to the
 * caller-supplied stem rather than producing an empty path segment.
 *
 * The `garments` module keeps its own copy of this function. That is intentional:
 * §2.9 rule 5 keeps modules from reaching into each other, the two slug ceilings
 * differ (96 vs 200), and eight lines of string handling is a smaller cost than a
 * shared utility that couples the taxonomy to the catalogue.
 */

/** `categories.slug` is `varchar(96)` (§4.12). */
export const MAX_CATEGORY_SLUG_LENGTH = 96;

/**
 * `"Bridal Lehenga"` → `"bridal-lehenga"`.
 *
 * Returns an empty string when the input contains nothing sluggable; callers decide
 * what to do about that rather than having a placeholder invented for them.
 */
export function slugify(input: string, maxLength: number = MAX_CATEGORY_SLUG_LENGTH): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * The nth candidate for a stem whose earlier candidates were taken: `bridal`,
 * `bridal-2`, `bridal-3`, … The suffix is trimmed out of the stem, never appended
 * past the column ceiling.
 */
export function suffixedSlug(
  stem: string,
  attempt: number,
  maxLength: number = MAX_CATEGORY_SLUG_LENGTH,
): string {
  if (attempt <= 1) {
    return stem.slice(0, maxLength);
  }

  const suffix = `-${attempt}`;
  return `${stem.slice(0, maxLength - suffix.length).replace(/-+$/g, '')}${suffix}`;
}
