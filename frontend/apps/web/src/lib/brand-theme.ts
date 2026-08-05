import type { BrandSettings } from '@/lib/brand';
import type { CSSProperties } from 'react';

/**
 * The runtime-overridable half of the token set (A-27, §6.1).
 *
 * `CSSProperties` has no index signature, so the two custom properties are declared
 * rather than cast in. Declaring them is also the reason nothing else can be smuggled
 * into the style attribute: `brandThemeStyle` can only return this shape.
 */
export interface BrandThemeStyle extends CSSProperties {
  '--color-brand'?: string;
  '--color-brand-hover'?: string;
}

/**
 * A six-digit hex colour and nothing else.
 *
 * The API validates a submitted brand colour against the §D-20 contrast floor before it
 * is ever stored, but *that* check lives in another service, on another deployment
 * cadence, and covers only the keys the settings registry knows about today. This is the
 * check at the sink. It is deliberately the narrowest thing that can express a colour:
 * no `rgb()`, no `var()`, no named colour, no `#abc` shorthand — because every one of
 * those admits a character that would still be a valid CSS value after a `}` or a `;`.
 */
const BRAND_HEX = /^#[0-9A-Fa-f]{6}$/;

export function isBrandHex(value: unknown): value is string {
  return typeof value === 'string' && BRAND_HEX.test(value);
}

/**
 * The brand settings → the custom properties to put on `<html>`, or `undefined` when
 * there is nothing to override.
 *
 * Applied as a `style` attribute rather than as an injected `<style>` block. That is the
 * point of this function: there is no string concatenation, no stylesheet text and
 * therefore no HTML or CSS sink for a value to escape from. React serialises each custom
 * property as an attribute value; a value that somehow got past `isBrandHex` could still
 * only ever be a (broken) declaration, never a new rule, a new element or a script.
 *
 * `<html>` is what `:root` selects, so this is the same cascade position the old
 * `:root{…}` block occupied — an override that beats both the light and the dark token
 * defaults, in the first HTML response, with no repaint (A-27).
 */
export function brandThemeStyle(
  brand: Pick<BrandSettings, 'primaryColor' | 'primaryColorHover'> | null,
): BrandThemeStyle | undefined {
  if (brand === null) return undefined;

  const style: BrandThemeStyle = {};
  if (isBrandHex(brand.primaryColor)) style['--color-brand'] = brand.primaryColor;
  if (isBrandHex(brand.primaryColorHover)) style['--color-brand-hover'] = brand.primaryColorHover;

  return Object.keys(style).length === 0 ? undefined : style;
}
