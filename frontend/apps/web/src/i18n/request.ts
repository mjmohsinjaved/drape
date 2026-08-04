import { getRequestConfig } from 'next-intl/server';

import { defaultLocale, timeZone, toLocale } from './config';
import { loadMessages } from './messages';

/**
 * next-intl server configuration. Registered from `next.config.ts` via
 * `createNextIntlPlugin('./src/i18n/request.ts')`.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // `requestLocale` is the `[locale]` segment; an unknown value degrades to the default
  // rather than throwing, so a hand-typed URL renders English instead of a crash.
  const locale = toLocale(await requestLocale);

  return {
    locale,
    defaultLocale,
    timeZone,
    messages: await loadMessages(locale),
    // Latin numerals in both locales — the admin tables and prices depend on it (§6.7).
    formats: {
      number: {
        plain: { useGrouping: false },
        pkr: { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 },
      },
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
        long: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' },
      },
    },
  };
});
