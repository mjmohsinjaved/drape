import {
  format,
  formatDistance,
  formatDistanceToNow,
  isValid,
  parseISO,
  type Locale,
} from 'date-fns';

/**
 * Date formatting.
 *
 * The API returns ISO-8601 `timestamptz` strings. Every helper here accepts a string, a
 * millisecond epoch or a `Date`, and every helper takes a date-fns `locale` object so the Urdu UI
 * reads as Urdu. Callers pass the locale in (`import { enUS } from 'date-fns/locale'`) — this
 * package deliberately does not import all of date-fns' locales, which would bloat the bundle.
 *
 * NOTE: date-fns ships no `ur` locale. `apps/web` supplies a hand-rolled one that satisfies the
 * date-fns `Locale` shape and passes it here; nothing in this module assumes a built-in locale.
 */

export type DateInput = Date | string | number;

export interface FormatDateOptions {
  /** date-fns locale object. Omit for date-fns' built-in en-US. */
  locale?: Locale;
  /** Overrides the default pattern. */
  pattern?: string;
  /** Returned for null/undefined/unparseable input. Defaults to an em dash. */
  fallback?: string;
}

export interface FormatRelativeOptions {
  locale?: Locale;
  /** Append "ago" / "in" (localised). Defaults to true. */
  addSuffix?: boolean;
  /** Compare against this instant instead of `Date.now()` — makes tests deterministic. */
  now?: Date;
  fallback?: string;
}

export const DATE_PATTERN = 'd MMM yyyy';
export const DATE_TIME_PATTERN = 'd MMM yyyy, HH:mm';

const DEFAULT_FALLBACK = '—';

/** Normalises any accepted input to a valid `Date`, or `null` if it is not one. */
export function toDate(value: DateInput | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  let parsed: Date;
  if (value instanceof Date) {
    parsed = value;
  } else if (typeof value === 'number') {
    parsed = new Date(value);
  } else {
    parsed = parseISO(value);
    if (!isValid(parsed)) {
      // Tolerate non-ISO strings the browser still understands.
      parsed = new Date(value);
    }
  }

  return isValid(parsed) ? parsed : null;
}

/** `12 Aug 2026` — the default for dates without a meaningful time component. */
export function formatDate(
  value: DateInput | null | undefined,
  options: FormatDateOptions = {},
): string {
  const { locale, pattern = DATE_PATTERN, fallback = DEFAULT_FALLBACK } = options;
  const date = toDate(value);

  if (date === null) {
    return fallback;
  }

  return locale ? format(date, pattern, { locale }) : format(date, pattern);
}

/** `12 Aug 2026, 14:30` — for audit rows, job timelines and anything ordered by instant. */
export function formatDateTime(
  value: DateInput | null | undefined,
  options: FormatDateOptions = {},
): string {
  return formatDate(value, { ...options, pattern: options.pattern ?? DATE_TIME_PATTERN });
}

/** `3 hours ago` / `in 2 days`, localised. */
export function formatRelative(
  value: DateInput | null | undefined,
  options: FormatRelativeOptions = {},
): string {
  const { locale, addSuffix = true, now, fallback = DEFAULT_FALLBACK } = options;
  const date = toDate(value);

  if (date === null) {
    return fallback;
  }

  const distanceOptions = locale ? { addSuffix, locale } : { addSuffix };

  return now
    ? formatDistance(date, now, distanceOptions)
    : formatDistanceToNow(date, distanceOptions);
}
