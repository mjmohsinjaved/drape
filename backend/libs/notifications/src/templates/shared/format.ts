import { type NotificationLocale } from '../../interfaces/send-result.interface';

import { type TemplateContext } from './template-context';

/**
 * Date, number and percentage formatting for template copy.
 *
 * Numerals stay Latin in both locales — the admin tables and prices depend on it
 * (docs/ARCHITECTURE.md §6.7) — so the Urdu locale is requested with the `latn` numbering system.
 */
const INTL_LOCALE: Readonly<Record<NotificationLocale, string>> = {
  EN: 'en-PK',
  UR: 'ur-PK-u-nu-latn',
};

function intlLocale(locale: NotificationLocale): string {
  return INTL_LOCALE[locale];
}

export function formatDateTime(value: Date, context: TemplateContext): string {
  return new Intl.DateTimeFormat(intlLocale(context.locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: context.timeZone,
  }).format(value);
}

export function formatDate(value: Date, context: TemplateContext): string {
  return new Intl.DateTimeFormat(intlLocale(context.locale), {
    dateStyle: 'medium',
    timeZone: context.timeZone,
  }).format(value);
}

export function formatNumber(value: number, context: TemplateContext): string {
  return new Intl.NumberFormat(intlLocale(context.locale), {
    maximumFractionDigits: 0,
  }).format(value);
}

/** `12.5` → `12.5%`. Rounded to one decimal, trailing `.0` dropped. */
export function formatPercent(value: number, context: TemplateContext): string {
  const rounded = Math.round(value * 10) / 10;
  const formatted = new Intl.NumberFormat(intlLocale(context.locale), {
    maximumFractionDigits: 1,
  }).format(rounded);
  return `${formatted}%`;
}

/** Picks the value written for the active locale. */
export function pick<T>(
  locale: NotificationLocale,
  values: Readonly<Record<NotificationLocale, T>>,
): T {
  return values[locale];
}
