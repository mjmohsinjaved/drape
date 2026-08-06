'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@repo/utils';

import { LinkPending } from '@/components/navigation/LinkPending';

import type { ReactNode } from 'react';

export interface NavLinkProps {
  href: string;
  children: ReactNode;
  /** Treat any descendant path as active, e.g. `/admin/catalog/123` under `/admin/catalog`. */
  matchPrefix?: boolean;
  className?: string;
  activeClassName?: string;
  /** Renders the label for screen readers only — used by the icon-collapsed sidebar. */
  srOnlyLabel?: boolean;
  onNavigate?: () => void;
}

/**
 * A navigation link that knows whether it is the current page, and whether it is on its way.
 *
 * `aria-current="page"` is set from the same condition that drives the styling, so the active
 * item is announced as well as seen (D-20) — colour alone never carries the meaning.
 *
 * ═══ The pending state ═══
 *
 * On mobile data a nav item can sit for a second between the tap and the first byte of the new
 * segment, and `loading.tsx` cannot help there: a segment fallback does not paint until the
 * server starts streaming. So the item answers for itself.
 *
 * `LinkPending` goes in the `corner` — absolutely positioned against this `relative` anchor — so
 * the spinner appears and disappears without moving a single character of the label. A nav rail
 * that reflowed on every tap would be worse than the silence it replaced. `pending-dim` fades
 * the row alongside it, because a spinner in the corner of a dense sidebar is easy to miss.
 */
export function NavLink({
  href,
  children,
  matchPrefix = false,
  className,
  activeClassName,
  onNavigate,
}: NavLinkProps) {
  const pathname = usePathname();
  const isActive = matchPrefix ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      onClick={onNavigate}
      className={cn('relative pending-dim', className, isActive && activeClassName)}
    >
      {children}
      <LinkPending size="xs" placement="corner" />
    </Link>
  );
}
