import { describe, expect, it } from 'vitest';

import { CURRENCY_PRECISION, formatCurrency, getCurrencySymbol } from './format-currency';

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

  /**
   * The two surfaces used to run two formatters, and the same garment read `PKR 185,000.00` in
   * the console and `PKR 185,000` in the fitting room. One formatter now, and the difference is
   * a named argument.
   */
  describe('precision', () => {
    it('defaults to exact — dropping precision is never the accident', () => {
      expect(formatCurrency(185000.5, { hideSymbol: true })).toBe('185,000.50');
      expect(formatCurrency(185000.5, { hideSymbol: true, precision: 'exact' })).toBe(
        '185,000.50',
      );
    });

    it('quotes whole rupees for the consumer screens', () => {
      expect(formatCurrency(185000, { hideSymbol: true, precision: 'whole' })).toBe('185,000');
      expect(formatCurrency(185000.5, { hideSymbol: true, precision: 'whole' })).toBe('185,001');
    });

    it('renders the same amount on both surfaces, differing only in rounding', () => {
      const admin = normalise(formatCurrency(185000, { currency: 'PKR', locale: 'en' }));
      const consumer = normalise(
        formatCurrency(185000, { currency: 'PKR', locale: 'en', precision: 'whole' }),
      );

      expect(admin).toContain('185,000.00');
      expect(consumer).toContain('185,000');
      expect(consumer).not.toContain('.00');
      // Same symbol, same grouping, same numbering system.
      expect(admin.replace('185,000.00', '185,000')).toBe(consumer);
    });

    it('lets an explicit fraction-digit option override the convention', () => {
      expect(
        formatCurrency(1234.567, { hideSymbol: true, precision: 'whole', maximumFractionDigits: 1 }),
      ).toBe('1,234.6');
    });

    it('names both conventions in CURRENCY_PRECISION', () => {
      expect(CURRENCY_PRECISION.exact).toEqual({
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(CURRENCY_PRECISION.whole).toEqual({
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    });
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
