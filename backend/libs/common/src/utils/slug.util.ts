/**
 * URL slugs — `categories.slug` (§4.12) and `garments.slug` (§4.13).
 *
 * Deliberately ASCII-only. `nameUr` and `titleUr` are Urdu, and a slug derived from
 * either would be a percent-encoded string nobody can read, share or type — so the slug
 * always comes from the English field, and input with no ASCII letters at all produces
 * an empty string rather than an invented placeholder. Callers decide what to do about
 * that; a fallback chosen here would be a fallback nobody could see.
 *
 * Both modules used to keep a copy, each defending it with "the two column ceilings
 * differ (96 vs 200)". They differ in the *default* of a parameter that is passed
 * explicitly at every call site — which is not a difference in the function at all. The
 * ceilings stay where they belong, as `MAX_CATEGORY_SLUG_LENGTH` and
 * `MAX_GARMENT_SLUG_LENGTH` beside the columns they describe; `maxLength` is required
 * here so no caller can inherit the wrong one by accident.
 */

/**
 * `"Bridal Lehenga"` → `"bridal-lehenga"`.
 *
 * Returns an empty string when the input contains nothing sluggable.
 */
export function slugify(input: string, maxLength: number): string {
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
 * `bridal-2`, `bridal-3`, … The suffix is trimmed out of the stem, never appended past
 * the column ceiling.
 */
export function suffixedSlug(stem: string, attempt: number, maxLength: number): string {
  if (attempt <= 1) {
    return stem.slice(0, maxLength);
  }

  const suffix = `-${attempt}`;
  return `${stem.slice(0, maxLength - suffix.length).replace(/-+$/g, '')}${suffix}`;
}
