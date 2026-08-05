import { createNavigation } from 'next-intl/navigation';
import { describe, expect, it } from 'vitest';

import { locales } from '@/i18n/config';
import { routing } from '@/i18n/routing';
import { routes } from '@/lib/routes';

/**
 * The navigation convention — ARCHITECTURE §6.6.
 *
 * `routes.*` returns a **finished** URL: the `[locale]` segment is already on the front, because
 * it is a root segment that is always present (§6.7) and because `generateMetadata`,
 * `middleware.ts` and every server-side `redirect()` need a complete path and cannot call a hook.
 *
 * The corollary is the rule this file pins: those URLs go to `next/link` and `next/navigation`,
 * never to a primitive built from `routing`. next-intl's helpers prepend the active locale to
 * whatever they are handed, so composing the two produces `/en/en/…` — which matches no route,
 * falls through to the root `not-found.tsx`, and is what the try-on reveal was doing at the end
 * of a successful generation.
 */
describe('§6.6 — routes.* is the only place the locale is applied', () => {
  it('produces the reveal URL the try-on hands to router.replace()', () => {
    expect(routes.render('en', 'res_1')).toBe('/en/renders/res_1');
    expect(routes.render('ur', 'res_1')).toBe('/ur/renders/res_1');
  });

  it.each(locales)('prefixes every builder with exactly one /%s', (locale) => {
    const doubled = new RegExp(`^/(${locales.join('|')})/(${locales.join('|')})(/|$)`);

    for (const [name, url] of builtUrls(locale)) {
      expect(url, `${name} must start with /${locale}`).toMatch(
        new RegExp(`^/${locale}(/|$)`),
      );
      expect(url, `${name} applies the locale twice`).not.toMatch(doubled);
    }
  });

  /**
   * The negative half, asserted against the installed next-intl rather than described in a
   * comment. If this ever stops producing `/en/en/…`, the ban in `eslint.config.mjs` and the
   * convention above can be revisited — until then it is the reason both exist.
   */
  it('double-prefixes when a routes.* href is handed to next-intl navigation', () => {
    const { getPathname } = createNavigation(routing);

    expect(getPathname({ locale: 'en', href: routes.render('en', 'res_1') })).toBe(
      '/en/en/renders/res_1',
    );
    expect(getPathname({ locale: 'en', href: routes.admin.catalog('en') })).toBe(
      '/en/en/admin/catalog',
    );
  });

  it('has no source file importing a locale-aware navigation primitive', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { cwd } = await import('node:process');

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        const source = readFileSync(full, 'utf8');
        if (/from\s+['"](next-intl\/navigation|@\/i18n\/navigation)['"]/.test(source)) {
          offenders.push(full);
        }
      }
    };
    walk(join(cwd(), 'src'));

    expect(offenders, 'navigate with next/link + next/navigation and a routes.* href').toEqual([]);
  });
});

/** Every leaf builder in the map, called with a placeholder id, as `[name, url]`. */
function builtUrls(locale: 'en' | 'ur'): Array<[string, string]> {
  const built: Array<[string, string]> = [];

  const visit = (node: unknown, path: string): void => {
    if (typeof node === 'function') {
      const builder = node as (...args: string[]) => string;
      const args = Array.from({ length: builder.length - 1 }, () => 'id_1');
      built.push([path, builder(locale, ...args)]);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node)) visit(value, `${path}.${key}`);
    }
  };

  visit(routes, 'routes');
  return built;
}
