import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('joins plain class names', () => {
    expect(cn('rounded', 'border')).toBe('rounded border');
  });

  it('drops falsy values', () => {
    expect(cn('rounded', false, null, undefined, '', 0)).toBe('rounded');
  });

  it('resolves conditional objects and arrays', () => {
    expect(cn(['flex', { hidden: false, 'items-center': true }])).toBe('flex items-center');
  });

  it('lets the last conflicting Tailwind utility win', () => {
    expect(cn('p-2', 'p-6')).toBe('p-6');
    expect(cn('text-sm text-neutral-500', 'text-lg')).toBe('text-neutral-500 text-lg');
  });

  it('lets a caller className override a component default', () => {
    const componentDefault = 'inline-flex h-10 px-4 bg-neutral-900';
    expect(cn(componentDefault, 'bg-rose-600')).toBe('inline-flex h-10 px-4 bg-rose-600');
  });

  it('keeps logical-property utilities distinct from physical ones', () => {
    expect(cn('ms-2', 'me-4')).toBe('ms-2 me-4');
  });

  it('returns an empty string for no input', () => {
    expect(cn()).toBe('');
  });
});
