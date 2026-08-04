'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@repo/utils';

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
 * A navigation link that knows whether it is the current page.
 *
 * `aria-current="page"` is set from the same condition that drives the styling, so the active
 * item is announced as well as seen (D-20) — colour alone never carries the meaning.
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
      className={cn(className, isActive && activeClassName)}
    >
      {children}
    </Link>
  );
}
