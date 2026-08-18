import { createHash } from 'node:crypto';

import {
  buildTryOnCacheKey,
  fingerprint,
  isSha256Hex,
  sha256EmailHex,
  sha256Hex,
  TRYON_CACHE_KEY_SEPARATOR,
} from './hash.util';

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes a string as UTF-8', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('treats a Buffer and its UTF-8 string identically', () => {
    expect(sha256Hex(Buffer.from('Zarrin', 'utf8'))).toBe(sha256Hex('Zarrin'));
  });

  it('handles non-ASCII without mangling it', () => {
    expect(sha256Hex('عروسی')).toBe(
      createHash('sha256').update(Buffer.from('عروسی', 'utf8')).digest('hex'),
    );
  });

  it('returns lower-case hex of 64 characters', () => {
    expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sha256EmailHex', () => {
  it('lower-cases and trims before hashing, so one address has one digest', () => {
    expect(sha256EmailHex('  Ayesha@Example.COM ')).toBe(sha256Hex('ayesha@example.com'));
  });
});

describe('buildTryOnCacheKey', () => {
  const input = {
    garmentSourceHash: 'a'.repeat(64),
    personPhotoHash: 'b'.repeat(64),
    tryOnApiVersion: '2026-08-01',
    driver: 'gemini',
  };

  it('is sha256 of the four components joined in the §3.7 order', () => {
    const expected = sha256Hex(
      ['a'.repeat(64), 'b'.repeat(64), '2026-08-01', 'gemini'].join(TRYON_CACHE_KEY_SEPARATOR),
    );
    expect(buildTryOnCacheKey(input)).toBe(expected);
  });

  it('is deterministic', () => {
    expect(buildTryOnCacheKey(input)).toBe(buildTryOnCacheKey({ ...input }));
  });

  it('changes when the garment source changes', () => {
    expect(buildTryOnCacheKey({ ...input, garmentSourceHash: 'c'.repeat(64) })).not.toBe(
      buildTryOnCacheKey(input),
    );
  });

  it('changes when the person photo changes', () => {
    expect(buildTryOnCacheKey({ ...input, personPhotoHash: 'c'.repeat(64) })).not.toBe(
      buildTryOnCacheKey(input),
    );
  });

  it('changes when TRYON_API_VERSION is bumped, invalidating the whole cache', () => {
    expect(buildTryOnCacheKey({ ...input, tryOnApiVersion: '2026-09-01' })).not.toBe(
      buildTryOnCacheKey(input),
    );
  });

  it('changes when the driver changes, so an A-33 switch is not served the old renders', () => {
    expect(buildTryOnCacheKey({ ...input, driver: 'openai' })).not.toBe(buildTryOnCacheKey(input));
  });

  it('is order-sensitive: swapping the two hashes yields a different key', () => {
    expect(
      buildTryOnCacheKey({
        ...input,
        garmentSourceHash: input.personPhotoHash,
        personPhotoHash: input.garmentSourceHash,
      }),
    ).not.toBe(buildTryOnCacheKey(input));
  });

  it('rejects an empty component rather than hashing a partial key', () => {
    expect(() => buildTryOnCacheKey({ ...input, personPhotoHash: '' })).toThrow(/personPhotoHash/);
    expect(() => buildTryOnCacheKey({ ...input, tryOnApiVersion: '   ' })).toThrow(
      /tryOnApiVersion/,
    );
  });

  it('rejects a component containing the separator, which would make the join ambiguous', () => {
    expect(() => buildTryOnCacheKey({ ...input, tryOnApiVersion: '2026:08' })).toThrow(/":"/);
  });
});

describe('isSha256Hex', () => {
  it('accepts a 64-character lower-case hex digest', () => {
    expect(isSha256Hex(sha256Hex('x'))).toBe(true);
  });

  it('rejects upper case, wrong length and non-strings', () => {
    expect(isSha256Hex(sha256Hex('x').toUpperCase())).toBe(false);
    expect(isSha256Hex('abc')).toBe(false);
    expect(isSha256Hex(undefined)).toBe(false);
  });
});

describe('fingerprint', () => {
  it('is a prefix of the full digest', () => {
    expect(sha256Hex('ayesha@example.com')).toContain(fingerprint('ayesha@example.com'));
  });

  it('defaults to 12 characters', () => {
    expect(fingerprint('x')).toHaveLength(12);
  });

  it('clamps an out-of-range length instead of throwing', () => {
    expect(fingerprint('x', 1)).toHaveLength(4);
    expect(fingerprint('x', 999)).toHaveLength(64);
  });
});
