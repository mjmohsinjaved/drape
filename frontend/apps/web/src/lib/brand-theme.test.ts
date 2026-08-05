import { describe, expect, it } from 'vitest';

import { brandThemeStyle, isBrandHex } from './brand-theme';

/**
 * The brand colour is the only value the API can put into the document's styling (A-27),
 * which makes it the only string in the app worth treating as hostile. It used to be
 * concatenated into a `<style>` element through `dangerouslySetInnerHTML`; the guard was a
 * hex pattern applied in a *different service*, and `primaryColorHover` had no guard
 * anywhere at all. Under a CSP that still carries `script-src 'unsafe-inline'`, an escape
 * from that block would have been live script.
 *
 * Two things are asserted here, and the second is what makes the first survive a refactor:
 *
 *  1. nothing that is not a six-digit hex colour comes out of `brandThemeStyle`, and
 *  2. **both** overridable properties go through the same check — `primaryColorHover` is
 *     dead only by accident today, because no projector emits it, and the whole point of
 *     the finding was that adding the key would have sent it into the sink ungoverned.
 */
describe('brandThemeStyle', () => {
  const HOSTILE = [
    ['a rule terminator and a new rule', '#aabbcc;} body{background:url(//evil.test/x)'],
    ['a closing style tag', '</style><script>alert(1)</script>'],
    ['a CSS comment', '#aabbcc/*'],
    ['a url() reference', 'url(//evil.test/x)'],
    ['an expression', 'expression(alert(1))'],
    ['a var() indirection', 'var(--anything)'],
    ['an image-set', 'image-set("//evil.test/x")'],
    ['a named colour', 'red'],
    ['shorthand hex', '#abc'],
    ['hex with alpha', '#aabbccdd'],
    ['rgb()', 'rgb(1,2,3)'],
    ['leading whitespace', ' #aabbcc'],
    ['trailing whitespace', '#aabbcc '],
    ['a newline', '#aabbcc\n'],
    ['a non-hex digit', '#gggggg'],
    ['no hash', 'aabbcc'],
    ['nothing', ''],
  ] as const;

  it.each(HOSTILE)('drops primaryColor carrying %s', (_case, primaryColor) => {
    expect(isBrandHex(primaryColor)).toBe(false);
    expect(brandThemeStyle({ primaryColor, primaryColorHover: null })).toBeUndefined();
  });

  it.each(HOSTILE)('drops primaryColorHover carrying %s', (_case, primaryColorHover) => {
    // The key the backend registry does not emit today. It is validated all the same.
    expect(brandThemeStyle({ primaryColor: null, primaryColorHover })).toBeUndefined();
  });

  it('drops only the bad half when one of the two is valid', () => {
    expect(
      brandThemeStyle({ primaryColor: '#71202F', primaryColorHover: '#000;}html{display:none' }),
    ).toEqual({ '--color-brand': '#71202F' });
  });

  it.each(['#71202f', '#71202F', '#000000', '#FFFFFF'])('passes the hex colour %s', (hex) => {
    expect(brandThemeStyle({ primaryColor: hex, primaryColorHover: hex })).toEqual({
      '--color-brand': hex,
      '--color-brand-hover': hex,
    });
  });

  it('returns undefined when there is nothing to override', () => {
    expect(brandThemeStyle(null)).toBeUndefined();
    expect(brandThemeStyle({ primaryColor: null, primaryColorHover: null })).toBeUndefined();
  });

  it('never returns anything but the two brand custom properties', () => {
    const style = brandThemeStyle({ primaryColor: '#71202f', primaryColorHover: '#591626' });

    expect(Object.keys(style ?? {})).toEqual(['--color-brand', '--color-brand-hover']);
  });
});
