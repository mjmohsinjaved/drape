import { describe, expect, it } from 'vitest';

import { defaultLocale, locales } from './config';
import { namespaces } from './messages';
import {
  ALL_NAMESPACES,
  icuArguments,
  icuProse,
  namespaceFilesOnDisk,
  readNamespace,
} from './messages.testkit';

/**
 * The C-41 / §6.7 Urdu parity gate.
 *
 * §6.7: "A missing `ur` key falls back to `en` and fails CI in `ur`-complete mode." `loadMessages`
 * implements the fallback — it deep-merges `ur` over `en` — which is the right runtime behaviour
 * and the reason drift is invisible in the browser: a missing Urdu key renders English and
 * nothing looks broken. This file is the `ur`-complete mode that behaviour is supposed to be
 * paired with.
 *
 * What it cannot check: translation *quality*. It proves an Urdu string exists and is written in
 * Arabic script; it cannot prove the string says what the English one says. §8.3 rule 9 — "both
 * `en` and `ur` values written by the same author in the same pass" — remains a human obligation.
 */

const NON_DEFAULT_LOCALES = locales.filter((locale) => locale !== defaultLocale);

/**
 * Strings that are legitimately identical in both locales: proper nouns, and format strings whose
 * entire content is an ICU placeholder or punctuation. Every entry needs a reason.
 */
const IDENTICAL_BY_DESIGN = new Set([
  'common.appName', // The brand name is not translated.
  'common.footer.copyright', // "© {year} {name}" — placeholders and a symbol.
  'admin.catalog.form.fields.sku', // SKU is the industry acronym, used as-is in Urdu.
  'admin.catalog.form.placeholders.sku', // An example SKU, not prose.
  'admin.catalog.images.dimensions', // "{width}×{height}" — numerals stay Latin (§6.7).
  // "<bdi>{min}</bdi> – <bdi>{max}</bdi>" — two placeholders, a dash and the bidi-isolation tag
  // that stops an RTL reader seeing the maximum first. No prose to translate; the only thing a
  // translator could change is the order, and both locales want the same one.
  'browse.filters.priceRange',
  'admin.catalog.editor.description', // "SKU {sku}".
  'renders.detail.heading', // "{garment}" — the piece's own name.
  'shortlist.budget.total', // "{amount}" — a formatted number.
]);

describe('§6.7 — the ur catalogue is complete', () => {
  it('declares the same namespace list as the files on disk', () => {
    for (const locale of locales) {
      expect(namespaceFilesOnDisk(locale), locale).toEqual([...ALL_NAMESPACES].sort());
    }
  });

  describe.each(NON_DEFAULT_LOCALES)('%s', (locale) => {
    describe.each(namespaces)('%s.json', (namespace) => {
      const base = readNamespace(defaultLocale, namespace);
      const translated = readNamespace(locale, namespace);

      it('has every key the default locale has', () => {
        const missing = Object.keys(base).filter((key) => !(key in translated));
        expect(missing).toEqual([]);
      });

      it('has no key the default locale does not have', () => {
        // An extra key is dead weight: `loadMessages` merges it in, nothing reads it, and it
        // hides the fact that the English side was renamed without the Urdu side following.
        const extra = Object.keys(translated).filter((key) => !(key in base));
        expect(extra).toEqual([]);
      });

      it('carries the same ICU placeholders in every string', () => {
        // A dropped `{count}` is a silently broken sentence; an added one throws at render.
        const mismatched: string[] = [];
        for (const [key, value] of Object.entries(base)) {
          const other = translated[key];
          if (other === undefined) continue;
          const expected = icuArguments(value);
          const actual = icuArguments(other);
          if (expected.join(',') !== actual.join(',')) {
            mismatched.push(`${namespace}.${key}: en[${expected.join(',')}] ur[${actual.join(',')}]`);
          }
        }
        expect(mismatched).toEqual([]);
      });

      it('ships no untranslated English under the locale', () => {
        const untranslated: string[] = [];
        for (const [key, value] of Object.entries(base)) {
          const other = translated[key];
          if (other === undefined) continue;
          const path = `${namespace}.${key}`;
          if (IDENTICAL_BY_DESIGN.has(path)) continue;
          // Three or more consecutive Latin letters means prose, not a placeholder or a symbol.
          if (other === value && /[A-Za-z]{3}/.test(value)) untranslated.push(`${path}: "${value}"`);
        }
        expect(untranslated).toEqual([]);
      });

      it('writes Urdu prose in Arabic script', () => {
        const latinOnly: string[] = [];
        for (const [key, value] of Object.entries(translated)) {
          const path = `${namespace}.${key}`;
          if (IDENTICAL_BY_DESIGN.has(path)) continue;
          // Strip the ICU machinery, then require Arabic-script content in anything that still
          // has three or more consecutive Latin letters left.
          const prose = icuProse(value);
          if (/[A-Za-z]{3}/.test(prose) && !/[؀-ۿ]/.test(prose)) {
            latinOnly.push(`${path}: "${value}"`);
          }
        }
        expect(latinOnly).toEqual([]);
      });
    });
  });
});
