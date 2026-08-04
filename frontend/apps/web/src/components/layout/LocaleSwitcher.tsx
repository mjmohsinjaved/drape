'use client';

import { useLocaleStore } from '@repo/store';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@repo/ui';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Languages } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { locales, localeLabels, toLocale, type Locale } from '@/i18n/config';

export interface LocaleSwitcherProps {
  /** `icon` in the dense admin top bar, `full` where there is room for the label. */
  variant?: 'icon' | 'full';
}

/**
 * Language switch — C-41.
 *
 * Each language is written in its own script, so a reader who cannot read the current
 * interface can still find their own. Switching writes the `NEXT_LOCALE` cookie through
 * `useLocaleStore` (the server needs it, so it is a cookie and not `localStorage`, §6.5) and
 * then swaps the `[locale]` segment in place — she stays on the page she was reading.
 */
export function LocaleSwitcher({ variant = 'full' }: LocaleSwitcherProps) {
  const t = useTranslations('common.locale');
  const active = toLocale(useLocale());
  const pathname = usePathname();
  const router = useRouter();
  const setLocale = useLocaleStore((state) => state.setLocale);
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === active) return;
    setLocale(next);
    // `[locale]` is a root segment, so the swap is a single replacement at the front.
    const nextPath = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, `/${next}`);
    startTransition(() => {
      router.replace(nextPath);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={variant === 'icon' ? 'icon' : 'sm'}
          aria-label={t('label')}
          disabled={isPending}
        >
          <Languages aria-hidden="true" className="size-4" />
          {variant === 'full' && <span>{localeLabels[active]}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={() => switchTo(locale)}
            // The list itself is not translated: each label is in its own script.
            lang={locale}
          >
            <Check
              aria-hidden="true"
              className={locale === active ? 'size-4' : 'size-4 opacity-0'}
            />
            {localeLabels[locale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
