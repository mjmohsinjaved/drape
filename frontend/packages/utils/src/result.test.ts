import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, mapResult, ok, unwrapOr, type Result } from './result';

describe('result', () => {
  it('builds an ok arm', () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('builds an err arm', () => {
    const cause = new Error('nope');
    const result = err(cause);
    expect(result).toEqual({ ok: false, error: cause });
  });

  it('narrows through isOk / isErr', () => {
    const result: Result<string, Error> = ok('published');

    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);

    if (isOk(result)) {
      // Compile-time proof the union narrowed: `.value` only exists on the ok arm.
      expect(result.value.toUpperCase()).toBe('PUBLISHED');
    }
  });

  it('carries ok values that are themselves falsy', () => {
    expect(unwrapOr(ok(0), 99)).toBe(0);
    expect(unwrapOr(ok(''), 'fallback')).toBe('');
    expect(unwrapOr(ok(false), true)).toBe(false);
  });

  it('falls back only on the err arm', () => {
    expect(unwrapOr(err(new Error('x')) as Result<number>, 7)).toBe(7);
  });

  it('maps the ok arm and passes the err arm through untouched', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });

    const failure = err('BOOM');
    expect(mapResult(failure as Result<number, string>, (n) => n * 3)).toBe(failure);
  });

  it('supports a non-Error error channel', () => {
    const result: Result<never, 'QUOTA_EXHAUSTED'> = err('QUOTA_EXHAUSTED');
    expect(isErr(result) && result.error).toBe('QUOTA_EXHAUSTED');
  });
});
