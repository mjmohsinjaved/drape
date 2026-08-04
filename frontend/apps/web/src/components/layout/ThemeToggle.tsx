'use client';

import { useUiStore } from '@repo/store';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@repo/ui';
import { useTranslations } from 'next-intl';
import { Check, Monitor, Moon, Sun } from 'lucide-react';

const MODES = ['light', 'dark', 'system'] as const;

type ThemeMode = (typeof MODES)[number];

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Light ("Daylight") / dark ("Lamplight") / follow the system.
 *
 * Dark mode is opt-in via `class="dark"` on `<html>`, resolved from `prefers-color-scheme`
 * plus the stored preference (§6.1). The store owns the preference; this control only sets it.
 */
export function ThemeToggle() {
  const t = useTranslations('common.theme');
  const mode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);

  const ActiveIcon = ICONS[mode as ThemeMode] ?? Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={t('label')}>
          <ActiveIcon aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {MODES.map((option) => {
          const Icon = ICONS[option];
          return (
            <DropdownMenuItem key={option} onSelect={() => setThemeMode(option)}>
              <Icon aria-hidden="true" className="size-4" />
              {t(option)}
              <Check
                aria-hidden="true"
                className={option === mode ? 'ms-auto size-4' : 'ms-auto size-4 opacity-0'}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
