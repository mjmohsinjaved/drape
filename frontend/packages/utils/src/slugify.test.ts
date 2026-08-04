import { describe, expect, it } from 'vitest';

import { slugify } from './slugify';

describe('slugify', () => {
  it('produces a kebab-case ASCII slug', () => {
    expect(slugify('Zarrin Bridal Lehenga')).toBe('zarrin-bridal-lehenga');
  });

  it('collapses runs of punctuation and whitespace into one separator', () => {
    expect(slugify('  Zarrin --- Bridal   Lehenga!!  ')).toBe('zarrin-bridal-lehenga');
  });

  it('strips diacritics rather than dropping the letter', () => {
    expect(slugify('Café — Été 2026')).toBe('cafe-ete-2026');
    expect(slugify('Ångström')).toBe('angstrom');
  });

  it('transliterates the characters NFKD leaves alone', () => {
    expect(slugify('Straße')).toBe('strasse');
    expect(slugify('Łódź')).toBe('lodz');
    expect(slugify('Silk & Zari')).toBe('silk-and-zari');
  });

  it('handles non-Latin input safely instead of emitting a broken segment', () => {
    // Nothing ASCII survives, so the caller gets the fallback and can fall back to the uuid.
    expect(slugify('عروسی لہنگا')).toBe('');
    expect(slugify('عروسی لہنگا', { fallback: 'garment' })).toBe('garment');
    expect(slugify('لہنگا 2026')).toBe('2026');
    expect(slugify('新娘婚纱')).toBe('');
  });

  it('keeps non-Latin letters when allowUnicode is on', () => {
    expect(slugify('عروسی لہنگا', { allowUnicode: true })).toBe('عروسی-لہنگا');
    expect(slugify('新娘 婚纱', { allowUnicode: true })).toBe('新娘-婚纱');
  });

  it('never leaves a leading or trailing separator', () => {
    expect(slugify('---Lehenga---')).toBe('lehenga');
    expect(slugify('!!!')).toBe('');
  });

  it('accepts a custom separator', () => {
    expect(slugify('Zarrin Bridal Lehenga', { separator: '_' })).toBe('zarrin_bridal_lehenga');
  });

  it('caps the length without leaving a dangling separator', () => {
    expect(slugify('Zarrin Bridal Lehenga', { maxLength: 7 })).toBe('zarrin');
    expect(slugify('Zarrin Bridal Lehenga', { maxLength: 6 })).toBe('zarrin');
    expect(slugify('Zarrin Bridal Lehenga', { maxLength: 100 })).toBe('zarrin-bridal-lehenga');
  });

  it('degrades safely on empty and nullish input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
    expect(slugify(null, { fallback: 'untitled' })).toBe('untitled');
  });

  it('is idempotent', () => {
    const once = slugify('Zarrin Bridal Lehenga');
    expect(slugify(once)).toBe(once);
  });
});
