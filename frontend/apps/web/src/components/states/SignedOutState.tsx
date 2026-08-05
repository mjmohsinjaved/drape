'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ArrowRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Button, DirectionalIcon, EmptyState } from '@repo/ui';

import { toLocale ,type  Locale } from '@/i18n/config';
import { RETURN_TO_PARAM } from '@/lib/constants';
import { routes } from '@/lib/routes';


export interface SignedOutStateProps {
  /** Defaults to the active locale. Pass it only where a screen already has it to hand. */
  locale?: Locale;
  /**
   * Where to return after signing in. Defaults to the screen she is on, which is almost always
   * what is wanted. Must be an app-relative path — anything else is dropped, so this can never
   * become an open redirect.
   */
  returnTo?: string;
}

/**
 * Signed out — D-5, and deliberately **not** the permission-denied state.
 *
 * `AUTH_REQUIRED`, `SESSION_EXPIRED` and `SESSION_INVALID` used to render `DeniedState` on the
 * consumer screens and the admin console, because two feature-local lists disagreed about
 * whether they were authorisation failures. They are not: the API does not know who is asking.
 * Telling someone she has no access to her own shortlist because her session timed out is both
 * wrong and unactionable.
 *
 * This is the honest version — it names what happened, and the action is the one thing that
 * fixes it, carrying her back to where she was. It reveals no more than the permission-denied
 * screen does: nothing here says whether the resource exists.
 */
export function SignedOutState({ locale, returnTo }: SignedOutStateProps) {
  const t = useTranslations('errors.signedOut');
  const activeLocale = toLocale(useLocale());
  const pathname = usePathname();

  const candidate = returnTo ?? pathname;
  const safeReturnTo =
    typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//')
      ? candidate
      : undefined;

  const loginPath = routes.login(locale ?? activeLocale);
  const href =
    safeReturnTo === undefined
      ? loginPath
      : `${loginPath}?${RETURN_TO_PARAM}=${encodeURIComponent(safeReturnTo)}`;

  return (
    <EmptyState
      tone="neutral"
      title={t('title')}
      description={t('body')}
      action={
        <Button asChild variant="primary">
          <Link href={href}>
            {t('action')}
            <DirectionalIcon>
              <ArrowRight aria-hidden="true" className="size-4" />
            </DirectionalIcon>
          </Link>
        </Button>
      }
    />
  );
}
