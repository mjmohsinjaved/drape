import { describe, expect, it } from 'vitest';

import { categoryName } from './category-name';

/**
 * The rule lives in one function because it has two call sites that must agree — the landing
 * rail and the category page's heading *and* its metadata title. They disagreed before: the
 * rail rendered the Latin name to an Urdu reader, and the page rendered an Urdu heading under
 * an English browser tab.
 */
describe('categoryName', () => {
  it('gives an English reader the Latin name', () => {
    expect(categoryName({ name: 'Bridal Lehenga', nameUr: 'دلہن لہنگا' }, 'en')).toBe(
      'Bridal Lehenga',
    );
  });

  it('gives an Urdu reader the Urdu name', () => {
    expect(categoryName({ name: 'Bridal Lehenga', nameUr: 'دلہن لہنگا' }, 'ur')).toBe('دلہن لہنگا');
  });

  it('falls back to the Latin name rather than rendering an empty row', () => {
    // `nameUr` is optional per category, so an unnamed one must still be readable.
    expect(categoryName({ name: 'Sharara', nameUr: null }, 'ur')).toBe('Sharara');
    expect(categoryName({ name: 'Sharara', nameUr: '' }, 'ur')).toBe('Sharara');
    expect(categoryName({ name: 'Sharara', nameUr: '   ' }, 'ur')).toBe('Sharara');
  });
});
