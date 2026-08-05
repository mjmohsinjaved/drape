import { Fraunces, IBM_Plex_Mono, Manrope, Noto_Nastaliq_Urdu } from 'next/font/google';

/**
 * Typefaces — ARCHITECTURE §6.1 (D-2).
 *
 * Four faces, loaded once here and attached to <html> by the app's root layout. Each exposes a
 * CSS variable that `tokens.css` composes into `--font-display`, `--font-body`, `--font-urdu`
 * and `--font-mono` together with its fallback stack. Nothing outside `tokens.css` names a font
 * family.
 *
 *   import { fontVariables } from '@repo/ui';
 *   import { getDirection } from '@repo/utils';
 *   <html lang={locale} dir={getDirection(locale)} className={fontVariables}>
 *
 * `display: 'swap'` everywhere: the catalog is browsed on mid-range Android over a Pakistani
 * mobile connection, and a blocked first paint costs more than a swap does (§9.1). `adjustFontFallback`
 * stays on so the swap does not move the layout — CLS has to stay under 0.1 (D-8).
 *
 * **This file is the only declaration of the four faces.** `apps/web` used to declare them a
 * second time in `src/styles/fonts.ts` — that copy was the one actually shipped, and it had
 * dropped every `fallback` stack while this one had never been imported by anything. The two
 * fixes the app copy carried (the variable Fraunces cut, and `preload: false` on the two faces
 * that paint nothing on the public grid) are folded in below; the fallback stacks, which are
 * what a reader sees for the duration of the swap, are kept.
 */

/**
 * Display — Fraunces. Warm, slightly humanist, hand-cut; suits embroidered formalwear without
 * tipping into wedding-invitation script.
 *
 * Used with restraint: headings, product names, the result-reveal caption heading. Never body
 * copy, never below 18px, never in the admin console except page titles.
 */
export const fraunces = Fraunces({
  subsets: ['latin'],
  // `next/font` rejects `axes` alongside a static weight list: naming an axis means loading the
  // variable file, which carries the whole 100–900 range in one download rather than two static
  // cuts. 400 and 600 — the only two §6.1 uses — come out of that range. The static two-weight
  // form here failed the production build.
  weight: 'variable',
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
  variable: '--next-font-fraunces',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

/**
 * Body — Manrope. Quiet, excellent numerals for the admin tables, holds at 12px on a mid-range
 * Android. Everything that is not a heading: body copy, labels, buttons, tables, form fields.
 */
export const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--next-font-manrope',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

/**
 * Urdu — Noto Nastaliq Urdu. Applied to the whole document when lang="ur", because Fraunces and
 * Manrope have no Arabic-script coverage. Nastaliq needs vertical room: `tokens.css` raises line
 * height by `--leading-multiplier` under `[lang='ur']`.
 */
export const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--next-font-noto-nastaliq-urdu',
  fallback: ['Jameel Noori Nastaleeq', 'serif'],
  // 239 KB, and it paints no glyph on an English page. Declaring all four faces in the root
  // layout preloads all four on every route, so this was 60% of the preloaded font bytes
  // competing with the LCP thumbnails for the 2.5s 4G budget (§9.1). The @font-face and the CSS
  // variable survive — the browser fetches it when a glyph actually needs it, which on `ur` is
  // immediately.
  preload: false,
});

/** Mono — IBM Plex Mono. SKUs, references, ids, audit metadata. Admin only. */
export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--next-font-ibm-plex-mono',
  fallback: ['ui-monospace', 'monospace'],
  // Admin only, by the doc comment above — so it has no business being a high-priority preload
  // on the public catalog grid.
  preload: false,
});

/** Every font variable in one class string, for the <html> element. */
export const fontVariables: string = [
  fraunces.variable,
  manrope.variable,
  notoNastaliqUrdu.variable,
  ibmPlexMono.variable,
].join(' ');

export const fonts = {
  display: fraunces,
  body: manrope,
  urdu: notoNastaliqUrdu,
  mono: ibmPlexMono,
} as const;

export type FontRole = keyof typeof fonts;
