/**
 * Money and date formatting for the consumer screens — ARCHITECTURE §6.7.
 *
 * **Numerals stay Latin in both locales**: Urdu would otherwise render prices in Eastern Arabic
 * numerals, and the studio quotes figures in Latin digits. `formatCurrency` pins `latn` through
 * the `numberingSystem` option, which is the same thing the `-u-nu-latn` extension this file
 * used to append to the locale tag does.
 *
 * A `null` price is A-30's "prices are not public" and must never be formatted as zero — the
 * caller renders the "price in the studio" copy instead, which is why these return `null`.
 */

import { formatCurrency } from '@repo/utils';

const LATIN_NUMERALS = '-u-nu-latn';

/**
 * A consumer-facing price.
 *
 * This used to be a second implementation of `@repo/utils`' `formatCurrency`, identical but for
 * the rounding — so the same garment read `PKR 185,000` here and `PKR 185,000.00` in the admin
 * console. It now delegates, and states the one thing that is genuinely different about this
 * surface: a rental price is quoted in whole rupees (`precision: 'whole'`), because `.00` on
 * every card in the grid is noise she has to read past.
 *
 * The `null` return is kept — it is not a formatting concern but A-30's "no public price", and
 * the caller needs to tell it apart from a real zero.
 */
export function formatMoney(
  locale: string,
  amount: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amount === null || amount === undefined) return null;

  const hasCurrency = currency !== null && currency !== undefined && currency !== '';

  return formatCurrency(amount, {
    locale,
    precision: 'whole',
    ...(hasCurrency ? { currency } : { hideSymbol: true }),
  });
}

/** A short, unambiguous date. Dates go through `Intl` with `Asia/Karachi` (§6.7). */
export function formatDate(locale: string, iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';

  return new Intl.DateTimeFormat(`${locale}${LATIN_NUMERALS}`, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  }).format(parsed);
}

/**
 * Alt text for a catalog image (D-20). Prefers the studio's own alt text and falls back to a
 * described sentence — never an empty string, and never the filename.
 */
export function imageAlt(altText: string | null | undefined, fallback: string): string {
  const trimmed = altText?.trim();
  return trimmed === undefined || trimmed === '' ? fallback : trimmed;
}

/** Sentence-cases a facet value the API stores lowercase (`maroon` → `Maroon`). */
export function facetLabel(value: string, label: string | null): string {
  if (label !== null && label.trim() !== '') return label;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
