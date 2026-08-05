/**
 * Money formatting.
 *
 * The API always sends an amount plus a separate ISO-4217 currency code (ARCHITECTURE.md §2.1:
 * `decimal(18,2)` + `char(3)` defaulting to `PKR`). It never sends a formatted string, so all
 * presentation happens here.
 *
 * **One formatter, two surfaces.** The consumer screens once had their own reimplementation of
 * this file, differing only in rounding — so the same garment read `PKR 185,000.00` in the admin
 * console and `PKR 185,000` in the fitting room. Rounding is now a call-site decision:
 * {@link CURRENCY_PRECISION} names the two conventions, and the caller picks the one its surface
 * uses. Nothing else about the formatting differs between them.
 */

export const DEFAULT_CURRENCY = 'PKR';
export const DEFAULT_LOCALE = 'en-PK';

/**
 * The two rounding conventions in the product, named rather than spelled out at each call site.
 *
 * - `exact` — two fraction digits. The admin console, where a price is a value being *edited*
 *   and a hidden 50 paisa would be a data-entry trap.
 * - `whole` — no fraction digits. The consumer screens, where a rental price is quoted in whole
 *   rupees and `.00` on every card is noise.
 *
 * `exact` stays the default: dropping precision silently is the failure that loses money, and a
 * caller that has not thought about rounding should get the lossless answer.
 */
export const CURRENCY_PRECISION = {
  exact: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  whole: { minimumFractionDigits: 0, maximumFractionDigits: 0 },
} as const satisfies Record<string, { minimumFractionDigits: number; maximumFractionDigits: number }>;

export type CurrencyPrecision = keyof typeof CURRENCY_PRECISION;

export interface FormatCurrencyOptions {
  /** ISO 4217 code. Defaults to `PKR`. */
  currency?: string;
  /** BCP 47 tag. Drape passes the active UI locale (`en`, `ur`, …). */
  locale?: string;
  /**
   * Render the number only — no currency symbol or code. Use it where the column header or a
   * nearby label already carries the currency, and in numeric inputs.
   */
  hideSymbol?: boolean;
  /**
   * Numbering system. Defaults to `latn` so prices stay in Western digits in every locale —
   * an Urdu UI otherwise falls back to Extended Arabic-Indic digits (۱۲۳), which Pakistani
   * price lists do not use. Pass `undefined` to accept the locale's own default.
   */
  numberingSystem?: string;
  /**
   * Rounding convention — `exact` (2 dp, the admin default) or `whole` (0 dp, the consumer
   * screens). `minimumFractionDigits` / `maximumFractionDigits` override it when a single call
   * needs something neither covers.
   */
  precision?: CurrencyPrecision;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Returned when `amount` is not a finite number. Defaults to an em dash. */
  fallback?: string;
}

/**
 * Formats a monetary amount for display.
 *
 * @example formatCurrency(185000)                                 // "PKR 185,000.00" (en-PK)
 * @example formatCurrency(185000, { precision: 'whole' })         // "PKR 185,000"
 * @example formatCurrency(185000, { locale: 'ur-PK' })            // Urdu-shaped, Latin digits
 * @example formatCurrency(185000, { hideSymbol: true })           // "185,000.00"
 * @example formatCurrency(null as unknown as number)              // "—"
 */
export function formatCurrency(amount: number, options: FormatCurrencyOptions = {}): string {
  const precision = CURRENCY_PRECISION[options.precision ?? 'exact'];

  const {
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
    hideSymbol = false,
    minimumFractionDigits = precision.minimumFractionDigits,
    maximumFractionDigits = precision.maximumFractionDigits,
    fallback = '—',
  } = options;

  // Explicit `undefined` must mean "use the locale default", which a destructuring
  // default cannot express — hence the key check.
  const numberingSystem =
    'numberingSystem' in options ? options.numberingSystem : ('latn' as string | undefined);

  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return fallback;
  }

  const base: Intl.NumberFormatOptions = {
    minimumFractionDigits,
    maximumFractionDigits,
  };

  if (numberingSystem !== undefined) {
    // `numberingSystem` is a valid NumberFormat option; the DOM lib types lag behind ES2023.
    (base as { numberingSystem?: string }).numberingSystem = numberingSystem;
  }

  const intlOptions: Intl.NumberFormatOptions = hideSymbol
    ? { ...base, style: 'decimal' }
    : { ...base, style: 'currency', currency, currencyDisplay: 'narrowSymbol' };

  try {
    return new Intl.NumberFormat(locale, intlOptions).format(amount);
  } catch {
    // An unknown currency code, an unsupported `narrowSymbol` display, or a malformed locale.
    // Degrade rather than crash a price cell.
    try {
      return new Intl.NumberFormat(DEFAULT_LOCALE, { ...base, style: 'decimal' }).format(amount);
    } catch {
      return fallback;
    }
  }
}

/**
 * The currency symbol on its own — for input prefixes and column headers where
 * `hideSymbol: true` is used for the values themselves.
 */
export function getCurrencySymbol(
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);

    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}
