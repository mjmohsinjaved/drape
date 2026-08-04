import 'server-only';

import { cache } from 'react';

import { apiPaths } from '@/lib/routes';
import { serverGetOrNull } from '@/lib/server-api';

/**
 * Public brand configuration — `GET /settings/brand` (§5.4, A-27).
 *
 * Only three things are overridable at runtime: `--color-brand`, `--color-brand-hover` and
 * the logo asset (§6.1). Everything else in the token set is compile-time. The API validates
 * a submitted brand colour against the same contrast rules the build asserts, and rejects a
 * failing value — so anything that arrives here is already known to pass D-20.
 */
export interface BrandSettings {
  name: string;
  logoUrl: string | null;
  /** Normative hex, validated server-side. Applied as a CSS custom property, never inline. */
  primaryColor: string | null;
  primaryColorHover: string | null;
  whatsappNumber: string | null;
  instagramHandle: string | null;
  contactEmail: string | null;
  showPricesPublicly: boolean;
  sharingEnabled: boolean;
  enquiriesEnabled: boolean;
}

/**
 * Fetched once per request — `cache()` dedupes it across the root layout and anything else
 * that asks. A failure is not fatal: the app falls back to the compile-time lac-red brand
 * token rather than showing an error, because a settings outage must never take the catalog
 * down.
 */
export const getBrandSettings = cache(async (): Promise<BrandSettings | null> => {
  return serverGetOrNull<BrandSettings>(apiPaths.brandSettings);
});
