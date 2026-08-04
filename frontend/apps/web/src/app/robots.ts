import { env } from '@/lib/env';
import { NOINDEX_SEGMENTS } from '@/lib/routes';

import type { MetadataRoute } from 'next';

/**
 * Crawler policy.
 *
 * Browsing is public and should be found (C-1). Everything behind a session, every
 * token-bearing URL and the no-access screen are disallowed — both because they are useless to
 * a crawler and because a share token must never end up in an index.
 *
 * Staging and development are disallowed entirely; only production is crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  const isProduction = env.NEXT_PUBLIC_APP_ENV === 'production';

  if (!isProduction) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  // `/{locale}` is a root segment, so each rule is written for both locales.
  const disallow = NOINDEX_SEGMENTS.flatMap((segment) => [`/en/${segment}/`, `/ur/${segment}/`]);

  return {
    rules: [{ userAgent: '*', allow: '/', disallow }],
    sitemap: new URL('/sitemap.xml', env.NEXT_PUBLIC_SITE_URL).toString(),
  };
}
