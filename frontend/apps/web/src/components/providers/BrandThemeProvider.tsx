import { getBrandSettings } from '@/lib/brand';

import type { ReactNode } from 'react';

export interface BrandThemeProviderProps {
  children: ReactNode;
}

/**
 * Applies the studio's brand colour (A-27).
 *
 * This is a Server Component on purpose. The brand settings are fetched server-side and the
 * three overridable custom properties are written into the first HTML response, so the page
 * never paints in the default lac red and then repaints in the studio's colour.
 *
 * **Only three tokens are runtime-overridable** — `--color-brand`, `--color-brand-hover` and
 * the logo asset (§6.1). Everything else in the token set is compile-time. The API validates a
 * submitted colour against the same contrast floor the build asserts and rejects a failing
 * value with `SETTINGS_VALUE_INVALID` (D-20), so anything reaching this component is safe.
 *
 * If the settings call fails the app keeps the compile-time brand token: a settings outage
 * must never take the catalog down.
 */
export async function BrandThemeProvider({ children }: BrandThemeProviderProps) {
  const brand = await getBrandSettings();

  const overrides: string[] = [];
  if (brand?.primaryColor) overrides.push(`--color-brand:${brand.primaryColor}`);
  if (brand?.primaryColorHover) overrides.push(`--color-brand-hover:${brand.primaryColorHover}`);

  if (overrides.length === 0) return <>{children}</>;

  return (
    <>
      <style
        // A single custom-property declaration block. No selectors, no rules, no user content
        // — the values are server-validated hex strings from the settings key registry.
        dangerouslySetInnerHTML={{ __html: `:root{${overrides.join(';')}}` }}
      />
      {children}
    </>
  );
}
