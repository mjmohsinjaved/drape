import { direction, locales, type Locale } from '@/i18n/config';
import { APP_NAME } from '@/lib/constants';
import { env } from '@/lib/env';
import { isNoIndexPath } from '@/lib/routes';

import type { Metadata } from 'next';

export interface BuildMetadataOptions {
  locale: Locale;
  /** Page title without the brand suffix — `buildMetadata` adds it. */
  title: string;
  description: string;
  /** Absolute path including the locale prefix, from `@/lib/routes`. */
  path: string;
  /** Override the automatic decision. Protected and token-bearing paths are never indexed. */
  noIndex?: boolean;
  /** Absolute or app-relative OG image. Falls back to the shared brand card. */
  ogImage?: string;
  type?: 'website' | 'article';
}

/**
 * The shared social card. `public/og/` is the folder the architecture reserves for it
 * (§1.2); the artwork itself is a design deliverable, so this points at the agreed filename
 * rather than inventing one per page.
 */
const DEFAULT_OG_IMAGE = '/og/drape.png';

function absolute(path: string): string {
  return new URL(path, env.NEXT_PUBLIC_SITE_URL).toString();
}

/**
 * The single metadata builder — every page uses it so no screen ships without a title, a
 * description, a canonical URL, the `hreflang` pair and an Open Graph card.
 *
 * Copy passing through here is consumer-facing and has been through the §9.4 check: Drape is
 * a shortlisting tool. No description promises accuracy or says "see yourself in".
 */
export function buildMetadata({
  locale,
  title,
  description,
  path,
  noIndex,
  ogImage,
  type = 'website',
}: BuildMetadataOptions): Metadata {
  const shouldNoIndex = noIndex ?? isNoIndexPath(path);
  const canonical = absolute(path);

  // The same page in the other locale, so search engines and screen readers can pair them.
  const languages = Object.fromEntries(
    locales.map((alternate) => [
      alternate,
      absolute(path.replace(/^\/[a-z]{2}(?=\/|$)/, `/${alternate}`)),
    ]),
  );

  return {
    title,
    description,
    alternates: { canonical, languages },
    robots: shouldNoIndex
      ? { index: false, follow: false, nocache: true }
      : { index: true, follow: true },
    openGraph: {
      type,
      title: `${title} · ${APP_NAME}`,
      description,
      url: canonical,
      siteName: APP_NAME,
      locale,
      images: [{ url: absolute(ogImage ?? DEFAULT_OG_IMAGE), width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · ${APP_NAME}`,
      description,
      images: [absolute(ogImage ?? DEFAULT_OG_IMAGE)],
    },
    other: {
      // Helps assistive tech and crawlers agree with <html dir> on RTL pages (C-41).
      'content-language': locale,
      'x-direction': direction[locale],
    },
  };
}

/**
 * Root metadata: the title template, the canonical base and the defaults every page inherits.
 */
export function buildRootMetadata(locale: Locale, tagline: string): Metadata {
  return {
    metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
    title: {
      default: APP_NAME,
      template: `%s · ${APP_NAME}`,
    },
    description: tagline,
    applicationName: APP_NAME,
    formatDetection: { telephone: false, address: false, email: false },
    icons: { icon: '/icons/favicon.svg' },
    openGraph: {
      type: 'website',
      siteName: APP_NAME,
      locale,
      description: tagline,
    },
  };
}
