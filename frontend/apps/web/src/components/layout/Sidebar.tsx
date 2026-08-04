'use client';

import { useUiStore } from '@repo/store';
import { Button, ScrollArea, Separator, Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui';
import { cn } from '@repo/utils';
import { useTranslations } from 'next-intl';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { DirectionalIcon } from '@/components/DirectionalIcon';
import { NavLink } from '@/components/layout/NavLink';
import { adminNavGroups } from '@/components/layout/nav-items';
import { useIsRtl } from '@/hooks/use-direction';
import { useHasFinePointer } from '@/hooks/use-media-query';

import type { Locale } from '@/i18n/config';

export interface SidebarProps {
  locale: Locale;
  /** `fixed` is the desktop rail; `sheet` is the same list inside the mobile drawer. */
  variant?: 'fixed' | 'sheet';
  onNavigate?: () => void;
}

/**
 * The admin side navigation — D-4: dense, grouped, built for repetitive work.
 *
 * 264 px expanded, 72 px collapsed (§6.2). Collapsed it keeps the icons and moves the label
 * into a tooltip and an `aria-label`, so the destination is still announced.
 */
export function Sidebar({ locale, variant = 'fixed', onNavigate }: SidebarProps) {
  const t = useTranslations('admin.nav');
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const density = useUiStore((state) => state.adminDensity);
  const setDensity = useUiStore((state) => state.setAdminDensity);
  const hasFinePointer = useHasFinePointer();
  // Radix places a tooltip on a physical side, so the collapsed rail's tooltip has to be told
  // which way "outward" is. This is the only physical value in the file, and it is a prop.
  const isRtl = useIsRtl();

  // In the sheet the rail is always expanded — there is no room shortage to solve on a phone.
  const isCollapsed = variant === 'fixed' && collapsed;

  return (
    <div
      className={cn(
        'flex h-full flex-col border-e border-line bg-surface',
        variant === 'fixed' && (isCollapsed ? 'w-sidenav-collapsed' : 'w-sidenav'),
        variant === 'sheet' && 'w-full',
      )}
    >
      <ScrollArea className="flex-1">
        <nav aria-label={t('label')} className="flex flex-col gap-4 p-3">
          {adminNavGroups.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              {!isCollapsed && (
                <h2 className="px-3 pb-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {t(`groups.${group.labelKey}`)}
                </h2>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const label = t(item.labelKey);
                  const link = (
                    <NavLink
                      href={item.href(locale)}
                      matchPrefix={item.matchPrefix ?? false}
                      onNavigate={onNavigate}
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm text-ink-muted hover:bg-surface-sunken hover:text-ink',
                        isCollapsed && 'justify-center px-0',
                      )}
                      activeClassName="bg-brand-tint text-brand font-semibold"
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      {isCollapsed ? <span className="sr-only">{label}</span> : <span>{label}</span>}
                    </NavLink>
                  );

                  return (
                    <li key={item.key}>
                      {isCollapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side={isRtl ? 'left' : 'right'}>{label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>

      <Separator />

      <div className="flex flex-col gap-1 p-3">
        {/*
          §6.1: `compact` is offered only when a fine pointer is present, so the 44 x 44 px
          touch-target floor (D-10) can never be violated on a phone.
        */}
        {hasFinePointer && !isCollapsed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start"
            aria-pressed={density === 'compact'}
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
          >
            {density === 'compact' ? t('density.comfortable') : t('density.compact')}
          </Button>
        )}

        {variant === 'fixed' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('justify-start', isCollapsed && 'justify-center')}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? t('expand') : t('collapse')}
            onClick={toggleSidebar}
          >
            <DirectionalIcon>
              {isCollapsed ? (
                <PanelLeftOpen aria-hidden="true" className="size-4" />
              ) : (
                <PanelLeftClose aria-hidden="true" className="size-4" />
              )}
            </DirectionalIcon>
            {!isCollapsed && <span>{t('collapse')}</span>}
          </Button>
        )}
      </div>
    </div>
  );
}
