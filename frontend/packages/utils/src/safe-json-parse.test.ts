import { describe, expect, it } from 'vitest';

import { safeJsonParse, safeJsonStringify } from './safe-json-parse';

interface Garment {
  id: string;
  title: string;
}

const isGarment = (value: unknown): value is Garment =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).id === 'string' &&
  typeof (value as Record<string, unknown>).title === 'string';

describe('safeJsonParse', () => {
  it('returns the ok arm for valid JSON', () => {
    const result = safeJsonParse<Garment>('{"id":"0c0a","title":"Zarrin"}');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: '0c0a', title: 'Zarrin' });
    }
  });

  it('parses JSON primitives, not just objects', () => {
    expect(safeJsonParse('null')).toEqual({ ok: true, value: null });
    expect(safeJsonParse('0')).toEqual({ ok: true, value: 0 });
    expect(safeJsonParse('false')).toEqual({ ok: true, value: false });
    expect(safeJsonParse('"text"')).toEqual({ ok: true, value: 'text' });
    expect(safeJsonParse('[]')).toEqual({ ok: true, value: [] });
  });

  it('never throws on malformed input', () => {
    for (const input of ['', '{', '{"a":}', 'undefined', "{'a':1}", '[1,2,']) {
      const result = safeJsonParse(input);
      expect(result.ok, input).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
      }
    }
  });

  it('never throws on non-string input', () => {
    expect(safeJsonParse(null).ok).toBe(false);
    expect(safeJsonParse(undefined).ok).toBe(false);
    expect(safeJsonParse(42 as unknown as string).ok).toBe(false);
  });

  it('rejects structurally wrong payloads when a guard is supplied', () => {
    const good = safeJsonParse('{"id":"0c0a","title":"Zarrin"}', { guard: isGarment });
    const bad = safeJsonParse('{"id":42}', { guard: isGarment });

    expect(good.ok).toBe(true);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toBeInstanceOf(TypeError);
    }
  });

  it('applies a reviver', () => {
    const result = safeJsonParse<{ createdAt: unknown }>(
      '{"createdAt":"2026-08-12T00:00:00.000Z"}',
      { reviver: (key, value) => (key === 'createdAt' ? new Date(String(value)) : value) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.createdAt).toBeInstanceOf(Date);
    }
  });
});

describe('safeJsonStringify', () => {
  it('serialises normal values', () => {
    expect(safeJsonStringify({ a: 1 })).toEqual({ ok: true, value: '{"a":1}' });
  });

  it('honours the space argument', () => {
    expect(safeJsonStringify({ a: 1 }, 2)).toEqual({ ok: true, value: '{\n  "a": 1\n}' });
  });

  it('returns the error arm for a circular structure', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const result = safeJsonStringify(circular);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('returns the error arm for values JSON.stringify drops', () => {
    expect(safeJsonStringify(undefined).ok).toBe(false);
    expect(safeJsonStringify(() => undefined).ok).toBe(false);
  });

  it('returns the error arm rather than throwing on a BigInt', () => {
    expect(safeJsonStringify({ n: 1n }).ok).toBe(false);
  });
});
