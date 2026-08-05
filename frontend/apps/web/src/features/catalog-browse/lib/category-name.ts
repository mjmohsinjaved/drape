import type { PublicCategory } from '../api/types';
import type { Locale } from '@/i18n/config';

/**
 * The display name for a category in the reader's locale.
 *
 * `nameUr` is optional per category (A-4/A-6 let a studio name a category in Urdu, but do not
 * require it), so an Urdu reader falls back to the Latin name rather than seeing an empty row.
 * That fallback is the reason this is a function and not a field: the rule has to be identical
 * everywhere, or the same category reads one way on the landing rail and another on its own
 * page.
 */
export function categoryName(
  category: Pick<PublicCategory, 'name' | 'nameUr'>,
  locale: Locale,
): string {
  if (locale === 'ur' && category.nameUr !== null && category.nameUr.trim() !== '') {
    return category.nameUr;
  }
  return category.name;
}
