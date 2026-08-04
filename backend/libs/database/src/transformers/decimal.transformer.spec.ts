import {
  DECIMAL_PRECISION,
  DECIMAL_SCALE,
  decimalTransformer,
  nullableDecimalTransformer,
} from './decimal.transformer';

describe('decimalTransformer', () => {
  describe('to (TS -> pg)', () => {
    it('passes a finite number straight through', () => {
      expect(decimalTransformer.to(1234.56)).toBe(1234.56);
    });

    it('passes zero through rather than collapsing it to null', () => {
      expect(decimalTransformer.to(0)).toBe(0);
    });

    it('maps null and undefined to null', () => {
      expect(decimalTransformer.to(null)).toBeNull();
      expect(decimalTransformer.to(undefined)).toBeNull();
    });
  });

  describe('from (pg -> TS)', () => {
    it('parses the numeric string pg returns into a number', () => {
      const value = decimalTransformer.from('1234.56') as number;
      expect(typeof value).toBe('number');
      expect(value).toBe(1234.56);
    });

    it('returns null for a null column', () => {
      expect(decimalTransformer.from(null)).toBeNull();
    });

    it('preserves two-decimal precision that a float round-trip would lose', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754. Reading "0.30" back must be exact.
      expect(decimalTransformer.from('0.30')).toBe(0.3);
      expect(decimalTransformer.from('0.30')).not.toBe(0.1 + 0.2);
    });

    it('parses a large PKR amount inside the safe-integer range exactly', () => {
      // 16 integral digits is the decimal(18,2) ceiling; this one is < 2^53 minor units.
      expect(decimalTransformer.from('90071992547758.07')).toBe(90071992547758.07);
    });
  });

  describe('round trip', () => {
    it.each([0, 0.01, 0.3, 1, 99.99, 1234.56, 250000, 1000000.5])(
      'survives number -> pg string -> number for %p',
      (amount) => {
        const written = decimalTransformer.to(amount) as number;
        const stored = written.toFixed(DECIMAL_SCALE); // what pg stores at scale 2
        expect(decimalTransformer.from(stored)).toBe(amount);
      },
    );

    it('survives a null round trip', () => {
      const written = decimalTransformer.to(null) as null;
      expect(decimalTransformer.from(written)).toBeNull();
    });
  });

  it('declares the precision and scale every monetary column uses', () => {
    expect(DECIMAL_PRECISION).toBe(18);
    expect(DECIMAL_SCALE).toBe(2);
  });
});

describe('nullableDecimalTransformer', () => {
  it('round-trips a finite number', () => {
    const written = nullableDecimalTransformer.to(4999.99) as number;
    expect(nullableDecimalTransformer.from(written.toFixed(DECIMAL_SCALE))).toBe(4999.99);
  });

  it('maps null and undefined to null in both directions', () => {
    expect(nullableDecimalTransformer.to(null)).toBeNull();
    expect(nullableDecimalTransformer.to(undefined)).toBeNull();
    expect(nullableDecimalTransformer.from(null)).toBeNull();
    expect(nullableDecimalTransformer.from(undefined)).toBeNull();
  });

  it('refuses to hand pg a non-finite number', () => {
    expect(nullableDecimalTransformer.to(Number.NaN)).toBeNull();
    expect(nullableDecimalTransformer.to(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('reads blank and unparseable input back as null, never NaN', () => {
    expect(nullableDecimalTransformer.from('')).toBeNull();
    expect(nullableDecimalTransformer.from('   ')).toBeNull();
    expect(nullableDecimalTransformer.from('not-a-number')).toBeNull();
  });

  it('keeps zero distinguishable from null', () => {
    expect(nullableDecimalTransformer.to(0)).toBe(0);
    expect(nullableDecimalTransformer.from('0.00')).toBe(0);
  });
});
