/**
 * The ceiling `categories.slug` is generated against (§4.12).
 *
 * `slugify` and `suffixedSlug` themselves live in `@library/common`. They were
 * byte-identical here and in `garments`, and the comment that used to defend the copy
 * cited a difference in the *default* of a `maxLength` parameter that both call sites
 * always pass explicitly — which is not a difference in the function at all. The column
 * width is the part that is genuinely per-module, so it is the part that stays here.
 */

/** `categories.slug` is `varchar(96)` (§4.12). */
export const MAX_CATEGORY_SLUG_LENGTH = 96;
