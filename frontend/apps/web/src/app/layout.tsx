import { getLocale, getTranslations } from 'next-intl/server';

import { fontVariables, Toaster } from '@repo/ui';
import { getDirection } from '@repo/utils';

import { AppProviders } from '@/components/providers/AppProviders';
import { toLocale } from '@/i18n/config';
import { getBrandSettings } from '@/lib/brand';
import { brandThemeStyle } from '@/lib/brand-theme';
import { buildRootMetadata } from '@/lib/metadata';

import '@/styles/globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  const locale = toLocale(await getLocale());
  const t = await getTranslations({ locale, namespace: 'common' });
  return buildRootMetadata(locale, t('tagline'));
}

/**
 * The root layout.
 *
 * `lang` and `dir` are set here from the active locale, so the whole document is right-to-left
 * for Urdu before a single component renders (§6.7). Nothing below this point contains a
 * physical CSS side — RTL is free, not retrofitted.
 *
 * The studio's brand colour (A-27) is resolved here, server-side, and written onto `<html>`
 * as custom properties in the first HTML response — so the page never paints in the default
 * lac red and then repaints in the studio's colour. `<html>` is what `:root` selects, so the
 * override sits exactly where the token defaults do.
 *
 * It is a `style` attribute, **not** an injected `<style>` block. A stylesheet built by string
 * concatenation is an HTML sink, and a sink that a settings value reaches is a sink an
 * attacker reaches the moment a validator upstream is relaxed, renamed or bypassed. There is
 * no string to escape from here, and `brandThemeStyle` will not return a value that is not a
 * six-digit hex colour. A settings outage keeps the compile-time token: the catalog stays up.
 *
 * Provider order (§ patterns, §6.1):
 *  1. `AppProviders` — the single client boundary: theme mode, Radix direction, tooltips and
 *     the query client.
 *  2. `Toaster` — the notification overlay, above everything.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = toLocale(await getLocale());
  const dir = getDirection(locale);
  const brandStyle = brandThemeStyle(await getBrandSettings());

  return (
    <html
      lang={locale}
      dir={dir}
      className={fontVariables}
      style={brandStyle}
      // The theme class is written by `ThemeProvider` before paint; React must not object.
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <AppProviders direction={dir}>
          {children}
          <Toaster />
        </AppProviders>
      </body>
    </html>
  );
}
