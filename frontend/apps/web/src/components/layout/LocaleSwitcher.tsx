'use client';

import { useState, useTransition } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import { Check, Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { useUiActions } from '@repo/store';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  useReportNavigationPending,
} from '@repo/ui';



import { apiLocale, locales, localeLabels, toLocale, type Locale } from '@/i18n/config';

export interface LocaleSwitcherProps {
  /** `icon` in the dense admin top bar, `full` where there is room for the label. */
  variant?: 'icon' | 'full';
}

/**
 * Language switch — C-41.
 *
 * Each language is written in its own script, so a reader who cannot read the current
 * interface can still find their own. Switching swaps the `[locale]` segment in place — she
 * stays on the page she was reading — and the next-intl middleware writes the `NEXT_LOCALE`
 * cookie on that navigation, because the server needs it and `localStorage` is not readable
 * there (§6.5, §6.7).
 *
 * The locale mirror lives on `useUiStore`, and its `setLocale` only records what has been
 * negotiated: a store never touches the document or the router. **Direction is not mirrored
 * anywhere** — it is derived from the `[locale]` segment by `getDirection` and published once by
 * the `DirectionProvider` in the root layout, which is also what Radix reads. A client store
 * that lagged this navigation by a frame would flip an icon the wrong way.
 */
export function LocaleSwitcher({ variant = 'full' }: LocaleSwitcherProps) {
  const t = useTranslations('common.locale');
  const active = toLocale(useLocale());
  const pathname = usePathname();
  const router = useRouter();
  const { setLocale } = useUiActions();
  const [isPending, startTransition] = useTransition();
  /*
    Which language was picked, so the indicator sits on the row that was pressed rather than on
    the control that opened the menu. This switch is a full document navigation — a swapped
    `[locale]` segment plus a `router.refresh()` — and on mobile data it is one of the slowest
    things in the app, which is exactly the case §9.1 is written against.
  */
  const [switchingTo, setSwitchingTo] = useState<Locale | null>(null);

  // Not a `<Link>`, so there is no `useLinkStatus()` to read — but it is still a navigation, and
  // the bar at the top of the viewport has to cover it or the slowest transition in the app is
  // the one with no feedback.
  useReportNavigationPending(isPending);

  function switchTo(next: Locale) {
    if (next === active) return;
    setSwitchingTo(next);
    setLocale(apiLocale[next]);
    // `[locale]` is a root segment, so the swap is a single replacement at the front.
    const nextPath = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, `/${next}`);
    /*
      The query string is part of where she is. `usePathname` drops it, so switching language on
      `/en/browse?color=maroon&page=3` used to land on `/ur/browse` — every filter and the page
      number gone, which reads as the app having thrown her work away for choosing her own
      language. It is read from `location` rather than `useSearchParams` on purpose: this control
      sits in the header of every page, and `useSearchParams` opts the whole tree out of static
      rendering unless it is wrapped in its own Suspense boundary. Inside an event handler
      `location.search` is current by definition.
    */
    const query = typeof window === 'undefined' ? '' : window.location.search;
    startTransition(() => {
      router.replace(`${nextPath}${query}`);
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
        {locales.map((locale) => {
          // Derived, not stored: the moment the transition ends the row stops being pending, so
          // there is no second piece of state to reset and nothing to leave stuck on screen.
          const isSwitchingToThis = isPending && switchingTo === locale;

          return (
            <DropdownMenuItem
              key={locale}
              onSelect={() => switchTo(locale)}
              // The list itself is not translated: each label is in its own script.
              lang={locale}
            >
              {/*
                The spinner takes the tick's slot rather than sitting beside it — same `size-4`
                box, so the row does not change width and the label does not move. The
                announcement is left to the one polite region `NavigationProgress` owns, so this
                is decoration only (D-20).
              */}
              {isSwitchingToThis ? (
                <Spinner size="xs" label={null} aria-hidden="true" className="size-4" />
              ) : (
                <Check
                  aria-hidden="true"
                  className={locale === active ? 'size-4' : 'size-4 opacity-0'}
                />
              )}
              {localeLabels[locale]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
