/**
 * The ceiling `garments.slug` is generated against (§4.13).
 *
 * `slugify` and `suffixedSlug` themselves live in `@library/common` — see
 * `categories/utils/slug.util.ts` for why the pair is no longer duplicated. Only the
 * column width is per-module, and only it stays here.
 */

/** `garments.slug` is `varchar(200)` (§4.13). */
export const MAX_GARMENT_SLUG_LENGTH = 200;
