import { describe, expect, it } from 'vitest';

import { formatCurrency, getCurrencySymbol } from './format-currency';

/** Intl inserts U+00A0 / U+202F between symbol and number depending on locale and ICU build. */
const normalise = (value: string): string => value.replace(/[\u00A0\u202F\u2009]/g, ' ');

describe('formatCurrency', () => {
  it('defaults to PKR with two fraction digits', () => {
    const output = normalise(formatCurrency(185000));
    expect(output).toContain('185,000.00');
    expect(output).toMatch(/(Rs|₨|PKR)/);
  });

  it('groups and rounds to two decimals', () => {
    expect(formatCurrency(1234.567, { hideSymbol: true })).toBe('1,234.57');
    expect(formatCurrency(0, { hideSymbol: true })).toBe('0.00');
  });

  it('hides the symbol on request', () => {
    const output = formatCurrency(185000, { hideSymbol: true });
    expect(output).toBe('185,000.00');
    expect(output).not.toMatch(/(Rs|₨|PKR)/);
  });

  it('renders correctly under an Urdu locale', () => {
    const output = normalise(formatCurrency(185000, { locale: 'ur-PK' }));

    // Latin digits by default, so an Urdu price list stays readable to both audiences…
    expect(output).toContain('185,000.00');
    // …and no Extended Arabic-Indic digits leak through.
    expect(output).not.toMatch(/[۰-۹٠-٩]/);
    expect(output).not.toBe('');
  });

  it('honours an explicit numbering system when one is asked for', () => {
    const output = formatCurrency(1500, {
      locale: 'ur-PK',
      hideSymbol: true,
      numberingSystem: 'arabext',
    });
    expect(output).toMatch(/[۰-۹]/);
  });

  it('supports other currencies', () => {
    const output = normalise(formatCurrency(1500, { currency: 'USD', locale: 'en-US' }));
    expect(output).toContain('1,500.00');
    expect(output).toContain('$');
  });

  it('honours explicit fraction-digit overrides', () => {
    const output = formatCurrency(185000, {
      hideSymbol: true,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    expect(output).toBe('185,000');
  });

  it('formats negative amounts', () => {
    expect(formatCurrency(-250, { hideSymbol: true })).toBe('-250.00');
  });

  it('returns the fallback for non-finite input instead of "NaN"', () => {
    expect(formatCurrency(Number.NaN)).toBe('—');
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatCurrency(undefined as unknown as number)).toBe('—');
    expect(formatCurrency(Number.NaN, { fallback: 'Not set' })).toBe('Not set');
  });

  it('degrades to a plain number rather than throwing on a bad currency code', () => {
    const output = formatCurrency(1500, { currency: 'not-a-code' });
    expect(output).toContain('1,500.00');
  });
});

describe('getCurrencySymbol', () => {
  it('returns a symbol for PKR', () => {
    expect(getCurrencySymbol()).not.toBe('');
  });

  it('falls back to the code itself when the code is unknown', () => {
    expect(getCurrencySymbol('not-a-code')).toBe('not-a-code');
  });
});
