/**
 * `@repo/utils` — pure, framework-free helpers shared across the Drape frontend.
 *
 * Nothing here may import React, Next.js, an API client or a store: this package sits at the
 * bottom of the dependency graph and every other workspace package is allowed to depend on it.
 * It is consumed source-first (`exports` points at `src/index.ts`) and transpiled by the Next
 * app through `transpilePackages`, so there is no build step and no stale `dist/`.
 */

export { buildQueryString, appendQueryString } from './build-query-string';
export type {
  BuildQueryStringOptions,
  QueryParams,
  QueryPrimitive,
  QueryValue,
} from './build-query-string';

export { NBSP, formatBytes } from './bytes';
export type { FormatBytesOptions } from './bytes';

export { cn } from './cn';
export type { ClassValue } from './cn';

export { debounce } from './debounce';
export type { DebounceOptions, DebouncedFunction } from './debounce';

export {
  CURRENCY_PRECISION,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  formatCurrency,
  getCurrencySymbol,
} from './format-currency';
export type { CurrencyPrecision, FormatCurrencyOptions } from './format-currency';

export {
  DATE_PATTERN,
  DATE_TIME_PATTERN,
  formatDate,
  formatDateTime,
  formatRelative,
  toDate,
} from './format-date';
export type { DateInput, FormatDateOptions, FormatRelativeOptions } from './format-date';

export { RTL_LANGUAGE_SUBTAGS, getDirection, isRtlLocale } from './is-rtl-locale';
export type { Direction } from './is-rtl-locale';

export { err, isErr, isOk, mapResult, ok, unwrapOr } from './result';
export type { Err, Ok, Result } from './result';

export { safeJsonParse, safeJsonStringify } from './safe-json-parse';
export type { SafeJsonParseOptions } from './safe-json-parse';

export { SleepAbortError, sleep } from './sleep';
export type { SleepOptions } from './sleep';

export { slugify } from './slugify';
export type { SlugifyOptions } from './slugify';

export { truncate } from './truncate';
export type { TruncateOptions } from './truncate';
