'use client';

import { useState } from 'react';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Sheet, SheetContent, SheetTitle, SheetTrigger } from '@repo/ui';


import { Sidebar } from '@/components/layout/Sidebar';

import type { Locale } from '@/i18n/config';

export interface AdminMobileMenuProps {
  locale: Locale;
}

/**
 * The admin navigation on a phone — D-9: the console stays usable for enquiry handling and
 * approvals on a small screen, so the same rail is available from a drawer rather than being
 * dropped.
 *
 * The drawer opens from the start edge in both writing directions. `SheetSide` is logical, so
 * `start` is the left edge in `en` and the right edge in `ur` with no conditional here — a
 * physical `left`/`right` would need a `[dir]` branch the codebase deliberately does not have
 * (C-41, §6.7).
 */
export function AdminMobileMenu({ locale }: AdminMobileMenuProps) {
  const t = useTranslations('admin.nav');
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 lg:hidden"
          aria-label={t('openMenu')}
        >
          <Menu aria-hidden="true" className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="start" className="w-72 p-0">
        <SheetTitle className="sr-only">{t('label')}</SheetTitle>
        <Sidebar locale={locale} variant="sheet" onNavigate={() => setIsOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
