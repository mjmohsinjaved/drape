import { Fraunces, IBM_Plex_Mono, Manrope, Noto_Nastaliq_Urdu } from 'next/font/google';

/**
 * Typefaces — ARCHITECTURE §6.1 (D-2). Declared once, self-hosted by `next/font` at build
 * time, and exposed as the four CSS custom properties the token layer consumes:
 * `--next-font-fraunces`, `--next-font-manrope`, `--next-font-noto-nastaliq-urdu`,
 * `--next-font-ibm-plex-mono`.
 *
 * `display: 'swap'` on all four: a visible fallback beats invisible text on a mid-range
 * Android over a slow connection.
 */

/** Display — headings, product names, the result-reveal caption heading. Used with restraint. */
export const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '600'],
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
  variable: '--next-font-fraunces',
});

/** Body — everything else, including every admin table and numeral. */
export const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--next-font-manrope',
});

/**
 * Urdu — applied to the whole document when `lang="ur"`. Fraunces has no Arabic-script
 * coverage, so the display face steps aside for Nastaliq (§6.7).
 */
export const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--next-font-noto-nastaliq-urdu',
});

/** Mono — SKUs, references, ids, audit metadata. Admin only. */
export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--next-font-ibm-plex-mono',
});

/** The class list the root `<html>` carries so all four variables are in scope everywhere. */
export const fontVariables = [
  fraunces.variable,
  manrope.variable,
  notoNastaliqUrdu.variable,
  ibmPlexMono.variable,
].join(' ');
