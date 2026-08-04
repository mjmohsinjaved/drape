import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isLocale, locales, timeZone } from '@/i18n/config';

import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';

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
 * `<html lang dir>` is already set by the root layout; this layer only makes the messages
 * available to client components. An unknown locale is a 404 rather than a silent fallback —
 * `/fr/browse` is not a Drape URL.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Opts this subtree into static rendering where the segment allows it.
  setRequestLocale(locale);

  const messages = await getMessages({ locale });

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}
