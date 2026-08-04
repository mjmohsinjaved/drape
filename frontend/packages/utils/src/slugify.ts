/**
 * URL-segment slugs.
 *
 * URL path segments are kebab-case (ARCHITECTURE.md §2.2). Slugs are a *convenience* label —
 * the API always identifies resources by uuid — so an unsluggable title (an all-Urdu garment
 * name, for instance) must degrade to the fallback rather than produce a broken URL.
 */

export interface SlugifyOptions {
  /**
   * Keep Unicode letters and digits instead of stripping to ASCII. Produces `عروسی-لہنگا`,
   * which is a valid IRI segment and is percent-encoded by the browser. Off by default so
   * links stay copy-pasteable in plain-text contexts.
   */
  allowUnicode?: boolean;
  /** Separator between words. Defaults to `-`. */
  separator?: string;
  /** Hard cap on the result length in characters. `0` (default) means no cap. */
  maxLength?: number;
  /** Returned when nothing sluggable survives. Defaults to an empty string. */
  fallback?: string;
}

/** Characters that transliterate to ASCII but that NFKD does not decompose. */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/đ/g, 'd'],
  [/ð/g, 'd'],
  [/þ/g, 'th'],
  [/ł/g, 'l'],
  [/&/g, ' and '],
];

const escapeForCharacterClass = (value: string): string => value.replace(/[\\\]^-]/g, '\\$&');

/**
 * Converts arbitrary text into a lowercase, kebab-case URL segment.
 *
 * @example slugify('Zarrin Bridal Lehenga')                    // "zarrin-bridal-lehenga"
 * @example slugify('Café — Été 2026')                          // "cafe-ete-2026"
 * @example slugify('عروسی لہنگا')                               // ""  (nothing ASCII survives)
 * @example slugify('عروسی لہنگا', { allowUnicode: true })      // "عروسی-لہنگا"
 */
export function slugify(input: string | null | undefined, options: SlugifyOptions = {}): string {
  const { allowUnicode = false, separator = '-', maxLength = 0, fallback = '' } = options;

  if (typeof input !== 'string' || input.trim() === '') {
    return fallback;
  }

  let working = input.toLowerCase();

  for (const [pattern, replacement] of TRANSLITERATIONS) {
    working = working.replace(pattern, replacement);
  }

  // Decompose accented characters, then drop the combining marks (é → e + ́  → e).
  working = working.normalize('NFKD').replace(/\p{M}+/gu, '');

  const keep = allowUnicode ? /[^\p{L}\p{N}]+/gu : /[^a-z0-9]+/g;
  const escapedSeparator = escapeForCharacterClass(separator);
  const trimSeparators = new RegExp(`^[${escapedSeparator}]+|[${escapedSeparator}]+$`, 'g');

  let slug = working.replace(keep, separator).replace(trimSeparators, '');

  if (maxLength > 0 && Array.from(slug).length > maxLength) {
    slug = Array.from(slug).slice(0, maxLength).join('').replace(trimSeparators, '');
  }

  return slug === '' ? fallback : slug;
}
