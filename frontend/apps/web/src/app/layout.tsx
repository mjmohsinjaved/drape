import { Toaster } from '@repo/ui';
import { getLocale, getTranslations } from 'next-intl/server';

import { AppProviders } from '@/components/providers/AppProviders';
import { BrandThemeProvider } from '@/components/providers/BrandThemeProvider';
import { direction, toLocale } from '@/i18n/config';
import { buildRootMetadata } from '@/lib/metadata';
import { fontVariables } from '@/styles/fonts';

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
 * Provider order (§ patterns, §6.1):
 *  1. `BrandThemeProvider` — a Server Component. It fetches the studio's brand settings and
 *     writes the three overridable custom properties into the first response, so the page
 *     never paints in one brand colour and repaints in another (A-27).
 *  2. `AppProviders` — the single client boundary: theme mode, Radix direction, tooltips and
 *     the query client.
 *  3. `Toaster` — the notification overlay, above everything.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = toLocale(await getLocale());

  return (
    <html
      lang={locale}
      dir={direction[locale]}
      className={fontVariables}
      // The theme class is written by `ThemeProvider` before paint; React must not object.
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <BrandThemeProvider>
          <AppProviders direction={direction[locale]}>
            {children}
            <Toaster />
          </AppProviders>
        </BrandThemeProvider>
      </body>
    </html>
  );
}
