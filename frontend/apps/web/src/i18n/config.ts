/**
 * i18n contract — ARCHITECTURE §6.7 (C-41).
 *
 * Two locales. Urdu gets full RTL, not a bolted-on stylesheet: direction is derived once by
 * `getDirection` from `@repo/utils`, applied once on <html dir>, and every layout below it uses
 * logical CSS properties only. There are no `[dir='rtl']` selectors anywhere in this codebase.
 *
 * **Direction is not declared here.** A hardcoded `{ en: 'ltr', ur: 'rtl' }` map lived in this
 * file and was a second, dumber answer to a question `@repo/utils` already answers from the
 * BCP-47 tag and its script subtag. Call `getDirection(locale)` — it is the only derivation.
 */
import type { Locale as ApiLocale } from '@repo/api-client';

export const locales = ['en', 'ur'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Human labels, each written in its own script — never "Urdu" in English in the switcher. */
export const localeLabels: Record<Locale, string> = { en: 'English', ur: 'اردو' };

/**
 * Dates, currency and relative times go through `Intl` with the active locale and this zone.
 * Numerals stay Latin in both locales — the admin tables and prices depend on it (§6.7).
 */
export const timeZone = 'Asia/Karachi';

/**
 * The cookie next-intl reads on the server. It is written by the next-intl middleware on the
 * navigation that changes language (`routing.localeCookie`), not by a store — `@repo/store`
 * never touches the document or the router (§6.5).
 */
export const localeCookieName = 'NEXT_LOCALE';

/**
 * The same two locales in their wire form. §2.2: enum values are UPPER_SNAKE_CASE on the wire
 * and in TypeScript, so `@repo/api-client` and `@repo/store` speak `'EN' | 'UR'` while the URL
 * segment and `<html lang>` stay lowercase BCP-47.
 */
export const apiLocale: Record<Locale, ApiLocale> = { en: 'EN', ur: 'UR' };

export function isLocale(value: string | undefined | null): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Narrows an unknown segment to a Locale, falling back to the default rather than throwing. */
export function toLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : defaultLocale;
}
