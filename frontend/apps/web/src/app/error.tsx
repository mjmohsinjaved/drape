'use client';

import { usePathname } from 'next/navigation';

import { NextIntlClientProvider } from 'next-intl';

import { RouteError } from '@/components/states';
import { timeZone, toLocale } from '@/i18n/config';
import enErrors from '@/i18n/messages/en/errors.json';
import urErrors from '@/i18n/messages/ur/errors.json';

import type { RouteErrorProps } from '@/lib/route-params';

/**
 * The root error boundary — D-5 error state.
 *
 * It catches anything a locale segment did not, and always offers the retry. It never shows a
 * status code or a stack trace (§8.1).
 *
 * ═══ Why it carries its own provider ═══
 *
 * `RouteError` reads `useTranslations`, and the only `NextIntlClientProvider` in the tree is
 * installed by `[locale]/layout.tsx` — **below** this boundary. So the one failure this boundary
 * exists for, the locale layout throwing, was also the one it could not render: `useTranslations`
 * found no context, threw inside the boundary, and the app escalated to `global-error.tsx`, the
 * unstyled English-only last resort. Every reader got the worst screen in the app, and an Urdu
 * reader got it in English.
 *
 * The `errors` catalogue is small enough (~1.4 KB per locale) to import statically for both,
 * which is what makes a provider above the locale segment possible at all: there is nothing to
 * await and nothing that can fail a second time. Both catalogues are complete —
 * `locale-parity.test.ts` is that gate — so `ur` is used directly rather than merged over `en`.
 */
export default function RootError({ error, reset }: RouteErrorProps) {
  // `[locale]` is a root segment, so the language is still in the URL even when the layout that
  // would have negotiated it is the thing that threw.
  const locale = toLocale(usePathname().split('/')[1]);

  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone={timeZone}
      messages={{ errors: locale === 'ur' ? urErrors : enErrors }}
    >
      <div className="mx-auto flex min-h-dvh max-w-consumer items-center justify-center px-5 py-16">
        <RouteError error={error} reset={reset} />
      </div>
    </NextIntlClientProvider>
  );
}
