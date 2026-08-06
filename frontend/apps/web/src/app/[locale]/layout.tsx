import { notFound } from 'next/navigation';

import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { NavigationProgressBar } from '@/components/navigation/NavigationProgressBar';
import { isLocale, locales, timeZone ,type  Locale } from '@/i18n/config';
import { loadClientMessages } from '@/i18n/messages';

import type { ReactNode } from 'react';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/** Both locales are known at build time, so every static shell can be pre-rendered. */
export function generateStaticParams(): Array<{ locale: Locale }> {
  return locales.map((locale) => ({ locale }));
}

/**
 * The locale segment.
 *
 * `<html lang dir>` is already set by the root layout; this layer only makes messages available
 * to client components. An unknown locale is a 404 rather than a silent fallback — `/fr/browse`
 * is not a Drape URL.
 *
 * ═══ It provides the `base` set, not all fifteen namespaces ═══
 *
 * This used to hand `getMessages()` — every namespace, merged — to the provider, which serialises
 * the lot into the HTML of every page. `admin.json` is ~39.5 KB of console copy that an anonymous
 * visitor on `/browse` can never read a word of, and the public grid is the screen §9.1 puts 2.5s
 * on. So the floor here is the shared chrome and the D-5 state shells, and each route group
 * layout re-provides with the set its own islands use (`CLIENT_NAMESPACES`).
 *
 * Server components are unaffected: `getTranslations` reads the request config, which still
 * carries all fifteen.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Opts this subtree into static rendering where the segment allows it.
  setRequestLocale(locale);

  const messages = await loadClientMessages(locale, 'base');

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {/*
        The route-transition bar (D-8, D-11, D-20). It lives here rather than in the root layout
        because its label is translated and `NextIntlClientProvider` starts at this segment; the
        counter it reads from is above it, in `AppProviders`. It is a fixed overlay, so mounting
        it before `children` costs no layout and covers both shells.
      */}
      <NavigationProgressBar />
      {children}
    </NextIntlClientProvider>
  );
}
