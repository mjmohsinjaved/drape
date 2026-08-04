/**
 * Money helpers — ARCHITECTURE.md §2.1 "Money".
 *
 * Every monetary column is `decimal(18,2)` paired with a `char(3)` currency column
 * defaulting to `'PKR'`. **Never store a formatted string.** These helpers work in
 * minor units internally so that repeated addition does not accumulate binary
 * floating-point error, and return plain 2-decimal numbers to match the column.
 */

/** Default currency for the whole platform (§2.1). ISO-4217 alpha-3. */
export const DEFAULT_CURRENCY = 'PKR';

/** Scale of a `decimal(18,2)` column. */
export const MONEY_SCALE = 2;

/** Precision of a `decimal(18,2)` column. */
export const MONEY_PRECISION = 18;

const MINOR_UNIT_FACTOR = 100;

/** The largest magnitude `decimal(18,2)` can hold. */
export const MAX_MONEY = 9_999_999_999_999_999.99;

/** true when `value` is a finite number representable in `decimal(18,2)`. */
export function isValidMoney(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_MONEY &&
    roundMoney(value) === value
  );
}

/** true when `value` is a plausible ISO-4217 alpha-3 currency code. */
export function isValidCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

/** Rounds to 2 decimal places, half away from zero — the sign-symmetric rule. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('roundMoney: value must be finite');
  }
  const scaled = value * MINOR_UNIT_FACTOR;
  // Nudge by one ULP-ish epsilon so 1.005 * 100 === 100.49999999999999 still rounds up.
  const rounded = Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
  return (Math.sign(scaled) * rounded) / MINOR_UNIT_FACTOR;
}

/** Converts a major-unit amount to integer minor units (paisa for PKR). */
export function toMinorUnits(amount: number): number {
  return Math.round(roundMoney(amount) * MINOR_UNIT_FACTOR);
}

/** Converts integer minor units back to a major-unit amount. */
export function fromMinorUnits(minorUnits: number): number {
  if (!Number.isInteger(minorUnits)) {
    throw new Error('fromMinorUnits: minorUnits must be an integer');
  }
  return minorUnits / MINOR_UNIT_FACTOR;
}

/** Exact addition via minor units. */
export function addMoney(a: number, b: number): number {
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));
}

/** Exact subtraction via minor units. */
export function subtractMoney(a: number, b: number): number {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

/** Multiplies an amount by a plain factor, rounding the result to 2 decimals. */
export function multiplyMoney(amount: number, factor: number): number {
  if (!Number.isFinite(factor)) {
    throw new Error('multiplyMoney: factor must be finite');
  }
  return fromMinorUnits(Math.round(toMinorUnits(amount) * factor));
}

/** Exact sum of a list of amounts. Empty list sums to 0. */
export function sumMoney(amounts: readonly number[]): number {
  return fromMinorUnits(amounts.reduce((total, amount) => total + toMinorUnits(amount), 0));
}

/** `percent` of `amount`, rounded to 2 decimals. */
export function percentOfMoney(amount: number, percent: number): number {
  return multiplyMoney(amount, percent / 100);
}

/**
 * The exact string a `decimal(18,2)` column stores — always two decimal places,
 * no thousands separators, no currency symbol.
 */
export function toDecimalString(amount: number): string {
  return roundMoney(amount).toFixed(MONEY_SCALE);
}

/**
 * Locale-aware display string. **Presentation only** — never persist the result.
 *
 * The API generally leaves formatting to the web app's `lib/format.ts`; this exists
 * for notification templates rendered server-side.
 */
export function formatMoney(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
  locale = 'en-PK',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: MONEY_SCALE,
    maximumFractionDigits: MONEY_SCALE,
  }).format(roundMoney(amount));
}

/**
 * Parses a decimal string as PostgreSQL returns it. Returns `null` for `null`,
 * mirroring `decimalTransformer` in `@library/database`.
 */
export function parseMoney(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}
