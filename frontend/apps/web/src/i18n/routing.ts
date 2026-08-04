import { defineRouting } from 'next-intl/routing';

import { defaultLocale, localeCookieName, locales } from './config';

/**
 * `[locale]` is a root dynamic segment and is always present in the URL, including for the
 * default locale. An always-visible prefix keeps share links (C-33) and the QR / bio short
 * link (A-32) unambiguous — a pasted URL carries its language with it.
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeDetection: true,
  localeCookie: {
    name: localeCookieName,
    // A year: the choice is hers and should survive a browser restart.
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  },
});
