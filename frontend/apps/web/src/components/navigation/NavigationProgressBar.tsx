'use client';

import { useTranslations } from 'next-intl';

import { NavigationProgress, useNavigationPending } from '@repo/ui';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

/**
 * The app's one route-transition bar, mounted once under `[locale]/layout.tsx`.
 *
 * It is separate from `NavigationPendingProvider` — which lives at the document root, above
 * every link that reports into it — because the label is translated, and `next-intl`'s client
 * provider begins at the locale segment. Splitting the two keeps the counter above everything
 * and the copy inside the only place it resolves.
 */
export function NavigationProgressBar() {
  const t = useTranslations('common');
  const { visible } = useNavigationPending();
  const reducedMotion = useReducedMotion();

  return (
    <NavigationProgress active={visible} label={t('navigating')} reducedMotion={reducedMotion} />
  );
}
