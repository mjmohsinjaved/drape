import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';

import { describe, expect, it } from 'vitest';

import { contrastRatio, parseColor, readTokenBlock, relativeLuminance } from './contrast';

/**
 * The D-20 contrast gate, promised by ARCHITECTURE §6.1: "The full palette is asserted by
 * `packages/ui/src/tokens/contrast.spec.ts`, which fails the build if any documented pair drops
 * below its stated ratio."
 *
 * The ratios written into the §6.1 table and repeated in the `tokens.css` comments are *nominal* —
 * they were rounded when the palette was chosen and several of them are out by a few hundredths.
 * Trusting them would mean asserting a comment against itself, so this file computes every ratio
 * from the shipped hex values and asserts the floors that actually protect a reader:
 *
 *  - **4.5 : 1** — WCAG 2.1 AA, normal-size text (§9.5, D-20).
 *  - **3 : 1**   — WCAG 2.1 AA, large text and non-text UI indicators (1.4.3, 1.4.11).
 *
 * Both modes are checked against every background a token is actually painted on, because a
 * value can clear the page ground and still fail on a card.
 *
 * This is a *computed* check, not a rendered one: it proves the token values are sound. It cannot
 * prove the browser paints them at those values (subpixel rendering, a user's colour filter, or a
 * component that stacks a token over a translucent scrim are all outside its reach).
 */

// Vitest runs with the package root as its working directory.
const TOKENS_CSS = readFileSync(join(cwd(), 'src', 'styles', 'tokens.css'), 'utf8');

const light = readTokenBlock(TOKENS_CSS, ':root');
const dark = { ...light, ...readTokenBlock(TOKENS_CSS, '.dark') };

/** WCAG 2.1 AA floors. */
const AA_TEXT = 4.5;
const AA_LARGE_TEXT = 3;
const AA_NON_TEXT = 3;

/**
 * The three grounds text is actually set on. `--color-surface-sunken` is deliberately absent: §6.1
 * scopes it to "wells, image placeholders, skeleton base", none of which carry body copy.
 */
const TEXT_BACKGROUNDS = ['--color-canvas', '--color-surface', '--color-surface-raised'] as const;

/**
 * §6.1: "Text colour is only ever --color-ink, --color-ink-muted, --color-ink-subtle,
 * --color-brand, --color-gold-text, --color-brand-fg or a semantic colour. Never --color-gold."
 */
const TEXT_TOKENS = [
  '--color-ink',
  '--color-ink-muted',
  '--color-ink-subtle',
  '--color-brand',
  '--color-gold-text',
  '--color-success',
  '--color-warning',
  '--color-danger',
  '--color-info',
] as const;

const SEMANTIC_PAIRS = [
  ['--color-success', '--color-success-tint'],
  ['--color-warning', '--color-warning-tint'],
  ['--color-danger', '--color-danger-tint'],
  ['--color-info', '--color-info-tint'],
  ['--color-gold-text', '--color-gold-tint'],
] as const;

const MODES = [
  ['light (Daylight)', light],
  ['dark (Lamplight)', dark],
] as const;

function ratio(palette: Record<string, string>, foreground: string, background: string): number {
  const fg = palette[foreground];
  const bg = palette[background];
  if (!fg || !bg) throw new Error(`tokens.css is missing ${!fg ? foreground : background}`);
  return contrastRatio(fg, bg);
}

describe('contrast helpers', () => {
  it('computes the WCAG reference ratios', () => {
    // The two anchors from the WCAG 2.1 definition itself.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#71202f', '#fbf8f3')).toBeCloseTo(contrastRatio('#fbf8f3', '#71202f'), 10);
  });

  it('reads the three- and six-digit hex forms and rgb()', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#1F1A16')).toEqual({ r: 31, g: 26, b: 22 });
    expect(parseColor('rgb(31 26 22 / 0.55)')).toEqual({ r: 31, g: 26, b: 22 });
    expect(parseColor('var(--something)')).toBeNull();
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('reads a token block without mistaking a comment for a value', () => {
    // `--color-ink` carries a trailing `/* … 16.6:1 on canvas */` in the source.
    expect(light['--color-ink']).toBe('#1f1a16');
    expect(light['--color-gold']).toBe('#a67c2e');
  });
});

describe.each(MODES)('§6.1 palette — %s', (_name, palette) => {
  describe.each(TEXT_TOKENS)('%s', (token) => {
    it.each(TEXT_BACKGROUNDS)(`reaches WCAG AA (${AA_TEXT}:1) on %s`, (background) => {
      expect(ratio(palette, token, background)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  });

  it('keeps text on a brand fill legible in every brand state', () => {
    for (const fill of ['--color-brand', '--color-brand-hover', '--color-brand-active']) {
      expect(ratio(palette, '--color-brand-fg', fill)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(SEMANTIC_PAIRS)('sets %s legibly on %s', (foreground, background) => {
    expect(ratio(palette, foreground, background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the focus ring visible against every ground it is drawn on (1.4.11)', () => {
    for (const background of [...TEXT_BACKGROUNDS, '--color-surface-sunken']) {
      expect(ratio(palette, '--color-focus', background)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it('holds --color-gold to the non-text floor it is scoped to', () => {
    // §6.1 permits gold on non-text and large text only. It must still clear 3:1 there.
    for (const background of TEXT_BACKGROUNDS) {
      expect(ratio(palette, '--color-gold', background)).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    }
  });
});

describe('§6.1 rules that must not be quietly repealed', () => {
  it('keeps --color-gold below the normal-text floor in light mode', () => {
    // This is *why* --color-gold-text exists. If a future palette change makes plain gold
    // text-safe, the §6.1 rule banning it from text has to be revisited in the same commit —
    // this assertion is what forces that conversation instead of letting the rule rot.
    expect(ratio(light, '--color-gold', '--color-canvas')).toBeLessThan(AA_TEXT);
  });

  it('gives --color-gold-text a real advantage over --color-gold', () => {
    expect(ratio(light, '--color-gold-text', '--color-canvas')).toBeGreaterThan(
      ratio(light, '--color-gold', '--color-canvas'),
    );
  });

  it('redeclares every mode-dependent colour token in .dark', () => {
    const darkOnly = readTokenBlock(TOKENS_CSS, '.dark');
    const missing = Object.keys(light).filter(
      (name) => name.startsWith('--color-') && !(name in darkOnly),
    );
    // The three CSS-wide keywords are the only colour tokens that mean the same in both modes.
    expect(missing).toEqual(['--color-transparent', '--color-current', '--color-inherit']);
  });
});
