/**
 * File-size formatting for the uploader progress rows and the admin storage panels.
 *
 * Defaults to decimal units (kB = 1000 bytes) because that is what operating systems and
 * upload dialogs show; pass `binary: true` for KiB/MiB where an exact power-of-two matters.
 */

const DECIMAL_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const;
const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/** Non-breaking space, so "1.5 MB" never wraps across a line in a table cell. */
export const NBSP = ' ';

export interface FormatBytesOptions {
  /** Fraction digits for values above 1 unit. Defaults to 1. */
  decimals?: number;
  /** Use 1024-based KiB/MiB units instead of 1000-based kB/MB. Defaults to false. */
  binary?: boolean;
  /** BCP 47 tag for the number formatting. Defaults to `en`. */
  locale?: string;
  /** Placed between the number and the unit. Defaults to a non-breaking space. */
  separator?: string;
  /** Returned for non-finite input. Defaults to an em dash. */
  fallback?: string;
}

/**
 * @example formatBytes(0)                      // "0 B"
 * @example formatBytes(1500)                   // "1.5 kB"
 * @example formatBytes(1024, { binary: true }) // "1 KiB"
 * @example formatBytes(5_242_880)              // "5.2 MB"
 */
export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  const { decimals = 1, binary = false, locale = 'en', separator = NBSP, fallback = '—' } = options;

  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) {
    return fallback;
  }

  const units = binary ? BINARY_UNITS : DECIMAL_UNITS;
  const base = binary ? 1024 : 1000;
  const sign = bytes < 0 ? '-' : '';
  const magnitude = Math.abs(bytes);

  if (magnitude < 1) {
    return `${sign}0${separator}${units[0]}`;
  }

  // Divided down rather than derived from a logarithm: Math.log is not exact at the unit
  // boundaries, and 1 MiB rendering as "1,024 KiB" is exactly the bug that would cause.
  let exponent = 0;
  let value = magnitude;
  while (value >= base && exponent < units.length - 1) {
    value /= base;
    exponent += 1;
  }

  const unit = units[exponent] ?? 'B';

  // Whole bytes are never shown with a decimal — "512 B", not "512.0 B".
  const fractionDigits = exponent === 0 ? 0 : Math.max(0, decimals);

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);

  return `${sign}${formatted}${separator}${unit}`;
}
