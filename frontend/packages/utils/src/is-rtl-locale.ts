/**
 * Direction helpers.
 *
 * Drape ships `en` and `ur` (ARCHITECTURE.md `locale_enum`), but the check is written against the
 * general set of right-to-left language subtags so adding a locale never needs a code change here.
 */

export type Direction = 'ltr' | 'rtl';

/**
 * ISO 639 language subtags written right-to-left.
 * Source: CLDR `characterOrder` = right-to-left.
 */
export const RTL_LANGUAGE_SUBTAGS: readonly string[] = [
  'ar', // Arabic
  'arc', // Aramaic
  'ckb', // Central Kurdish (Sorani)
  'dv', // Divehi
  'fa', // Persian
  'he', // Hebrew
  'iw', // Hebrew (legacy code)
  'khw', // Khowar
  'ks', // Kashmiri
  'ku', // Kurdish
  'nqo', // N'Ko
  'pnb', // Western Punjabi (Shahmukhi)
  'prs', // Dari
  'ps', // Pashto
  'sd', // Sindhi
  'syr', // Syriac
  'ug', // Uyghur
  'ur', // Urdu  ← Drape
  'uz-af', // Uzbek (Afghanistan, Arabic script)
  'yi', // Yiddish
];

/** Script subtags that force RTL regardless of the language (e.g. `pa-Arab`). */
const RTL_SCRIPT_SUBTAGS: readonly string[] = ['arab', 'aran', 'hebr', 'syrc', 'thaa', 'nkoo'];

const rtlLanguages = new Set(RTL_LANGUAGE_SUBTAGS);
const rtlScripts = new Set(RTL_SCRIPT_SUBTAGS);

/**
 * True when `locale` is written right-to-left.
 *
 * Accepts BCP 47 tags in any casing and tolerates the underscore form some backends emit
 * (`ur_PK`). Unknown, empty and malformed input is treated as left-to-right — the safe default,
 * since a wrong `dir` breaks layout everywhere rather than in one place.
 */
export function isRtlLocale(locale: string | null | undefined): boolean {
  if (typeof locale !== 'string') {
    return false;
  }

  const normalised = locale.trim().toLowerCase().replace(/_/g, '-');
  if (normalised === '') {
    return false;
  }

  const subtags = normalised.split('-');
  const language = subtags[0] ?? '';

  // `uz-af` style two-part entries.
  if (subtags.length > 1 && rtlLanguages.has(`${language}-${subtags[1] ?? ''}`)) {
    return true;
  }

  if (rtlLanguages.has(language)) {
    return true;
  }

  // A script subtag is exactly four letters, e.g. `pa-Arab-PK`.
  return subtags.slice(1).some((subtag) => subtag.length === 4 && rtlScripts.has(subtag));
}

/** `'rtl'` or `'ltr'` — ready for the `dir` attribute on `<html>`. */
export function getDirection(locale: string | null | undefined): Direction {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}
