'use client';

import { apiClient } from '@repo/api-client';
import { useAuthStore } from '@repo/store';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { accountMenuNav } from '@/components/layout/nav-items';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface UserMenuProps {
  locale: Locale;
  name: string;
  email: string;
  initials: string;
  /** Extra entries the admin shell adds above the account block. */
  extraItems?: readonly { key: string; label: string; href: string }[];
}

/**
 * The account menu, present in both shells on every screen.
 *
 * **C-40**: the data controls — everything stored about her, the export and the deletion
 * (C-37…C-39) — are reachable from this menu on every screen. `accountMenuNav` always ends
 * with that entry; it is not a per-screen decision and cannot be dropped by a shell.
 */
export function UserMenu({ locale, name, email, initials, extraItems }: UserMenuProps) {
  const t = useTranslations('common');
  const router = useRouter();
  const clearAuth = useAuthStore((state) => state.clear);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      // TODO(W1): swap for the generated `logout()` endpoint + `useLogout` mutation from
      // `@repo/api-client`, which also invalidates `queryKeys.auth.me()`.
      await apiClient.post('/auth/logout');
    } finally {
      // The store is presentation state only; the session itself died server-side (S-3).
      clearAuth();
      setIsSigningOut(false);
      router.replace(routes.home(locale));
      router.refresh();
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('userMenu.label')}
          className="min-h-11 min-w-11"
        >
          <Avatar initials={initials} alt="" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-xs text-ink-muted">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {extraItems?.map((item) => (
          <DropdownMenuItem key={item.key} asChild>
            <Link href={item.href}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
        {extraItems && extraItems.length > 0 && <DropdownMenuSeparator />}

        {accountMenuNav.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.key} asChild>
              <Link href={item.href(locale)}>
                <Icon aria-hidden="true" className="size-4" />
                {t(`nav.${item.labelKey}`)}
              </Link>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isSigningOut} onSelect={() => void handleSignOut()}>
          <LogOut aria-hidden="true" className="size-4" />
          {t('actions.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
