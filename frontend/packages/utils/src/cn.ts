import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution.
 *
 * `clsx` flattens conditionals/arrays/objects; `tailwind-merge` then drops earlier utilities
 * that a later one overrides, so a caller-supplied `className` always wins over a component
 * default (`cn('p-2', props.className)` with `className="p-6"` yields `p-6`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type { ClassValue };
