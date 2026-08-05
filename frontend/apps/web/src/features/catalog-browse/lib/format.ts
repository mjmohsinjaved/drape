/**
 * Money and date formatting for the consumer screens — ARCHITECTURE §6.7.
 *
 * **Numerals stay Latin in both locales**, which is why every formatter here pins
 * `-u-nu-latn` rather than trusting the locale default: Urdu would otherwise render prices in
 * Eastern Arabic numerals, and the studio quotes figures in Latin digits.
 *
 * A `null` price is A-30's "prices are not public" and must never be formatted as zero — the
 * caller renders the "price in the studio" copy instead, which is why these return `null`.
 */

const LATIN_NUMERALS = '-u-nu-latn';

export function formatMoney(
  locale: string,
  amount: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amount === null || amount === undefined) return null;

  if (currency === null || currency === undefined || currency === '') {
    return new Intl.NumberFormat(`${locale}${LATIN_NUMERALS}`, {
      maximumFractionDigits: 0,
    }).format(amount);
  }

  return new Intl.NumberFormat(`${locale}${LATIN_NUMERALS}`, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(amount);
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
