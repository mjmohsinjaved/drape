import { createHmac } from 'node:crypto';

import {
  base64UrlDecode,
  base64UrlEncode,
  hmacSign,
  hmacVerify,
  randomHex,
  randomId,
  randomToken,
  timingSafeEqualBuffer,
  timingSafeEqualString,
} from './crypto.util';

const SECRET = 'f'.repeat(64);

describe('randomToken', () => {
  it('produces URL-safe base64 by default', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces hex when asked', () => {
    expect(randomToken(32, 'hex')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats across calls', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
  });

  it('refuses a byte length below 128 bits of entropy', () => {
    expect(() => randomToken(8)).toThrow(/at least 16/);
    expect(() => randomToken(16.5)).toThrow(/integer/);
  });
});

describe('randomHex / randomId', () => {
  it('randomHex returns 2 characters per byte', () => {
    expect(randomHex(32)).toHaveLength(64);
  });

  it('randomId returns a v4 uuid', () => {
    expect(randomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('timingSafeEqualString', () => {
  it('is true for identical strings', () => {
    expect(timingSafeEqualString('abcdef', 'abcdef')).toBe(true);
  });

  it('is false for different strings of the same length', () => {
    expect(timingSafeEqualString('abcdef', 'abcdeg')).toBe(false);
  });

  it('is false for different lengths, without throwing', () => {
    expect(timingSafeEqualString('abc', 'abcdef')).toBe(false);
  });

  it('is false for empty input on both sides — an absent token never matches', () => {
    expect(timingSafeEqualString('', '')).toBe(false);
  });

  it('is false for non-string input', () => {
    expect(timingSafeEqualString(undefined as unknown as string, 'abc')).toBe(false);
  });

  it('compares multi-byte characters by bytes, not code units', () => {
    expect(timingSafeEqualString('é', 'é')).toBe(true);
    expect(timingSafeEqualString('é', 'e')).toBe(false);
  });
});

describe('timingSafeEqualBuffer', () => {
  it('is true for identical buffers', () => {
    expect(timingSafeEqualBuffer(Buffer.from('ab'), Buffer.from('ab'))).toBe(true);
  });

  it('is false for different lengths and for empty buffers', () => {
    expect(timingSafeEqualBuffer(Buffer.from('ab'), Buffer.from('abc'))).toBe(false);
    expect(timingSafeEqualBuffer(Buffer.alloc(0), Buffer.alloc(0))).toBe(false);
  });
});

describe('hmacSign', () => {
  it('matches a directly computed HMAC-SHA256', () => {
    const expected = createHmac('sha256', SECRET).update('payload', 'utf8').digest('base64url');
    expect(hmacSign('payload', SECRET)).toBe(expected);
  });

  it('supports hex encoding', () => {
    expect(hmacSign('payload', SECRET, { encoding: 'hex' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same payload and secret', () => {
    expect(hmacSign('payload', SECRET)).toBe(hmacSign('payload', SECRET));
  });

  it('changes with the secret', () => {
    expect(hmacSign('payload', SECRET)).not.toBe(hmacSign('payload', 'a'.repeat(64)));
  });

  it('domain-separates, so an upload token cannot be replayed as a download token', () => {
    const download = hmacSign('key.exp', SECRET);
    const upload = hmacSign('key.exp', SECRET, { domain: 'upload:' });
    expect(upload).not.toBe(download);
    expect(hmacVerify('key.exp', upload, SECRET)).toBe(false);
    expect(hmacVerify('key.exp', upload, SECRET, { domain: 'upload:' })).toBe(true);
  });

  it('refuses an empty secret rather than signing with a default', () => {
    expect(() => hmacSign('payload', '')).toThrow(/non-empty secret/);
    expect(() => hmacVerify('payload', 'sig', '')).toThrow(/non-empty secret/);
  });
});

describe('hmacVerify', () => {
  it('accepts a signature it produced', () => {
    expect(hmacVerify('payload', hmacSign('payload', SECRET), SECRET)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    expect(hmacVerify('payload!', hmacSign('payload', SECRET), SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(hmacVerify('payload', hmacSign('payload', 'a'.repeat(64)), SECRET)).toBe(false);
  });

  it('rejects an empty or truncated signature', () => {
    expect(hmacVerify('payload', '', SECRET)).toBe(false);
    expect(hmacVerify('payload', hmacSign('payload', SECRET).slice(0, 10), SECRET)).toBe(false);
  });
});

describe('base64Url helpers', () => {
  it('round-trips', () => {
    const payload = JSON.stringify({ key: 'renders/u/r.png', exp: 1_754_300_000 });
    expect(base64UrlDecode(base64UrlEncode(payload))).toBe(payload);
  });

  it('produces URL-safe output with no padding', () => {
    expect(base64UrlEncode('any?payload=here')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for a value that is not base64url', () => {
    expect(base64UrlDecode('not base64!')).toBeNull();
    expect(base64UrlDecode('has+slash/and=pad')).toBeNull();
  });
});
