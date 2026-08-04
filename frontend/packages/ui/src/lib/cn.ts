/**
 * `cn` is defined once, in `@repo/utils`, and re-exported here so atoms can import it from a
 * neighbouring path without every component file reaching across a package boundary.
 *
 * There is deliberately no second implementation: `tailwind-merge` has to be configured
 * identically everywhere or a caller-supplied `className` stops winning over a component
 * default, which is the whole contract of the prop.
 */
export { cn } from '@repo/utils';
export type { ClassValue } from '@repo/utils';
