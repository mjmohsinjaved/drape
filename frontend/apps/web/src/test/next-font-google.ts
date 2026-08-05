/**
 * `next/font/google` outside the Next compiler.
 *
 * `next/font` is a build-time transform, not a runtime module: the real import is rewritten by
 * the Next loader into a generated CSS module, so calling it under vitest throws
 * `(0, Fraunces) is not a function`. `@repo/ui`'s font declarations run at module scope, so the
 * throw takes down any test that imports a single design-system component.
 *
 * This stands in for it, aliased in `vitest.config.ts`. It returns the same shape the design
 * system reads — a class name, a CSS variable and a `style` — so `fontVariables` still composes
 * and nothing under test has to know it is running without a typeface.
 */

export interface StubFont {
  className: string;
  variable: string;
  style: { fontFamily: string };
}

function stub(name: string): () => StubFont {
  const slug = name.toLowerCase().replaceAll('_', '-');
  return () => ({
    className: `font-${slug}`,
    variable: `--font-${slug}`,
    style: { fontFamily: name },
  });
}

export const Fraunces = stub('Fraunces');
export const Manrope = stub('Manrope');
export const Noto_Nastaliq_Urdu = stub('Noto_Nastaliq_Urdu');
export const IBM_Plex_Mono = stub('IBM_Plex_Mono');
