import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware navigation primitives. Client Components import `Link`, `useRouter`,
 * `usePathname` and `redirect` from here rather than from `next/navigation`, so the active
 * locale prefix is never hand-assembled at a call site.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
