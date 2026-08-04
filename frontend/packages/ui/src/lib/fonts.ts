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
 *   <html lang={locale} dir={direction[locale]} className={fontVariables}>
 *
 * `display: 'swap'` everywhere: the catalog is browsed on mid-range Android over a Pakistani
 * mobile connection, and a blocked first paint costs more than a swap does (§9.1). `adjustFontFallback`
 * stays on so the swap does not move the layout — CLS has to stay under 0.1 (D-8).
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
  weight: ['400', '600'],
  style: ['normal'],
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
});

/** Mono — IBM Plex Mono. SKUs, references, ids, audit metadata. Admin only. */
export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--next-font-ibm-plex-mono',
  fallback: ['ui-monospace', 'monospace'],
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
