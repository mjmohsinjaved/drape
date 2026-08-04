import { describe, expect, it } from 'vitest';

import { formatBytes } from './bytes';

/** The helper joins with a non-breaking space; assertions read better against a plain one. */
const plain = (value: string): string => value.replace(/\u00A0/g, ' ');

describe('formatBytes', () => {
  it('formats zero and sub-byte values', () => {
    expect(plain(formatBytes(0))).toBe('0 B');
    expect(plain(formatBytes(0.4))).toBe('0 B');
  });

  it('shows whole bytes without a decimal', () => {
    expect(plain(formatBytes(1))).toBe('1 B');
    expect(plain(formatBytes(512))).toBe('512 B');
    expect(plain(formatBytes(999))).toBe('999 B');
  });

  it('uses decimal units by default', () => {
    expect(plain(formatBytes(1000))).toBe('1 kB');
    expect(plain(formatBytes(1500))).toBe('1.5 kB');
    expect(plain(formatBytes(5_242_880))).toBe('5.2 MB');
    expect(plain(formatBytes(1_000_000_000))).toBe('1 GB');
  });

  it('uses binary units on request', () => {
    expect(plain(formatBytes(1024, { binary: true }))).toBe('1 KiB');
    expect(plain(formatBytes(1_048_576, { binary: true }))).toBe('1 MiB');
    expect(plain(formatBytes(5_242_880, { binary: true }))).toBe('5 MiB');
  });

  it('honours the decimals option', () => {
    expect(plain(formatBytes(1536, { decimals: 0 }))).toBe('2 kB');
    expect(plain(formatBytes(5_242_880, { decimals: 2 }))).toBe('5.24 MB');
  });

  it('drops a trailing zero fraction', () => {
    expect(plain(formatBytes(2000))).toBe('2 kB');
  });

  it('formats negative sizes (deltas) with a sign', () => {
    expect(plain(formatBytes(-1500))).toBe('-1.5 kB');
  });

  it('caps at the largest known unit instead of producing an undefined suffix', () => {
    expect(plain(formatBytes(1e24))).toContain('PB');
  });

  it('accepts a custom separator', () => {
    expect(formatBytes(1500, { separator: '' })).toBe('1.5kB');
  });

  it('returns the fallback for non-finite input', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatBytes(undefined as unknown as number, { fallback: 'unknown' })).toBe('unknown');
  });

  it('is locale-aware for the numeric part', () => {
    expect(plain(formatBytes(1500, { locale: 'de-DE' }))).toBe('1,5 kB');
  });
});
