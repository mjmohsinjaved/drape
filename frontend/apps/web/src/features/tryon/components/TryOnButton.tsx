'use client';

import Link from 'next/link';

import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Callout } from '@repo/ui';

import { BudgetExhausted, QuotaExhausted } from '@/features/tryon/components/QuotaExhausted';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { useMyQuota } from '@/features/tryon/hooks/use-my-quota';
import { useStartTryOn } from '@/features/tryon/hooks/use-start-tryon';
import {
  isBudgetExhausted,
  isQuotaExhausted,
  needsAnotherPhoto,
} from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface TryOnButtonProps {
  locale: Locale;
  garmentId: string;
  garmentTitle: string;
  garmentThumbnailUrl?: string | null;
  /** Resolved server-side from the session. Presentation only — the API decides everything (S-3). */
  isAuthenticated: boolean;
  /** Where to return after signing in, agreeing to the policy, or adding a photo. */
  returnTo: string;
}

/**
 * The single prominent **Try it on** — C-18.
 *
 * One action, full width on a phone, at least 44px tall (§6.2, D-10). It carries no
 * pre-flight checks: the guard chain in the API is the authority (B-2), so this posts and reacts
 * to the answer. That means one round trip instead of three, and it means the button cannot
 * disagree with the server about whether she is allowed.
 *
 * A signed-out visitor gets a sign-in prompt rather than a disabled control, because C-1 makes
 * browsing genuinely public and a greyed-out button explains nothing.
 */
export function TryOnButton({
  locale,
  garmentId,
  garmentTitle,
  garmentThumbnailUrl,
  isAuthenticated,
  returnTo,
}: TryOnButtonProps) {
  const t = useTranslations('tryon.start');
  const tQuota = useTranslations('tryon.quota');
  const messageFor = useErrorMessage('tryon');
  const { start, isStarting, errorCode } = useStartTryOn({ locale, returnTo, isAuthenticated });
  // C-5: "Try-ons left this month" is visible wherever a try-on can be started, and this is that
  // place. It informs; it never gates — the API's guard chain is the authority (B-2).
  const quota = useMyQuota(isAuthenticated);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-2">
        <Button asChild variant="primary" size="lg" fullWidth>
          <Link href={`${routes.login(locale)}?from=${encodeURIComponent(returnTo)}`}>
            {t('signIn')}
          </Link>
        </Button>
        <p className="text-sm text-ink-muted">{t('signInNote')}</p>
      </div>
    );
  }

  if (errorCode !== null && isQuotaExhausted(errorCode)) {
    return <QuotaExhausted locale={locale} />;
  }
  if (errorCode !== null && isBudgetExhausted(errorCode)) {
    return <BudgetExhausted locale={locale} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        loading={isStarting}
        loadingLabel={t('starting')}
        startIcon={<Sparkles aria-hidden="true" />}
        onClick={() => {
          start({ garmentId, garmentTitle, garmentThumbnailUrl });
        }}
      >
        {t('action')}
      </Button>

      {quota.data === undefined ? null : (
        <p className="text-sm text-ink-muted">
          {tQuota('remaining', { remaining: quota.data.remaining, limit: quota.data.limit })}
        </p>
      )}

      {errorCode !== null ? (
        <Callout
          tone="warning"
          action={
            needsAnotherPhoto(errorCode) ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`${routes.photoNew(locale)}?from=${encodeURIComponent(returnTo)}`}>
                  {t('needsPhoto')}
                </Link>
              </Button>
            ) : undefined
          }
        >
          {messageFor(errorCode)}
        </Callout>
      ) : null}
    </div>
  );
}
