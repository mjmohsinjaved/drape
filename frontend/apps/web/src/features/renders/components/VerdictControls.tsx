'use client';

import { useCallback, useState } from 'react';

import Link from 'next/link';

import { Heart, HelpCircle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Callout } from '@repo/ui';

import { recordVerdict } from '@/features/renders/api/endpoints';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';
import { useRouter } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

import type { RejectReason, Verdict } from '@/features/renders/api/types';
import type { Locale } from '@/i18n/config';

export interface VerdictControlsProps {
  locale: Locale;
  resultId: string;
  /** Null once the garment has been hard-deleted — there is nothing left to have a verdict on. */
  garmentId: string | null;
  /** Joined from the shortlist. `undefined` when she has not decided yet. */
  current: Verdict | undefined;
}

const REASONS: readonly RejectReason[] = [
  'NECKLINE',
  'COLOR',
  'TOO_HEAVY',
  'SILHOUETTE',
  'PRICE',
];

/**
 * Love it / Maybe / Not for me — C-20, and the one-tap reason of C-21.
 *
 * Three equally weighted controls. None is styled as the expected answer: a shortlisting tool
 * that nudges toward "Love it" produces a shortlist she does not believe, and the rejection data
 * is what the studio actually learns from (A-38).
 *
 * The reason prompt appears **after** the verdict is already saved, never as a condition of it —
 * C-21 says "optionally captures", so Not for me is one tap and the reason is a second,
 * skippable one. Skipping is a visible control, not a dismissal she has to guess at.
 */
export function VerdictControls({
  locale,
  resultId,
  garmentId,
  current,
}: VerdictControlsProps) {
  const t = useTranslations('renders.verdict');
  const messageFor = useErrorMessage('renders');
  const router = useRouter();

  const [verdict, setVerdict] = useState<Verdict | undefined>(current);
  const [pending, setPending] = useState<Verdict | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const save = useCallback(
    (next: Verdict, rejectReason?: RejectReason): void => {
      if (garmentId === null) return;

      setPending(next);
      setErrorCode(null);

      void recordVerdict({ garmentId, verdict: next, rejectReason, resultId })
        .then(() => {
          setVerdict(next);
          setAskReason(next === 'NOT_FOR_ME' && rejectReason === undefined);
          // The shortlist and the history badge both change; the server components above are
          // what render them, so the segment is refreshed rather than patched by hand.
          router.refresh();
        })
        .catch((error: unknown) => {
          setErrorCode(resolveErrorCode(error));
        })
        .finally(() => {
          setPending(null);
        });
    },
    [garmentId, resultId, router],
  );

  if (garmentId === null) return null;

  const options: Array<{ value: Verdict; icon: React.ReactNode }> = [
    { value: 'LOVE_IT', icon: <Heart aria-hidden="true" /> },
    { value: 'MAYBE', icon: <HelpCircle aria-hidden="true" /> },
    { value: 'NOT_FOR_ME', icon: <X aria-hidden="true" /> },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">{t('heading')}</h2>
        <p className="text-sm text-ink-muted">{t('hint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={verdict === option.value ? 'primary' : 'secondary'}
            size="lg"
            fullWidth
            aria-pressed={verdict === option.value}
            startIcon={option.icon}
            loading={pending === option.value}
            loadingLabel={t('saving')}
            onClick={() => {
              save(option.value);
            }}
          >
            {t(option.value)}
          </Button>
        ))}
      </div>

      {verdict !== undefined && pending === null && errorCode === null ? (
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          {verdict === 'NOT_FOR_ME' ? t('savedRejected') : t('saved')}
        </p>
      ) : null}

      {askReason ? (
        <fieldset className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-4">
          <legend className="pb-2 text-sm font-medium text-pretty">{t('reasonHeading')}</legend>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((reason) => (
              <Button
                key={reason}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  save('NOT_FOR_ME', reason);
                }}
              >
                {t(`reasons.${reason}`)}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAskReason(false);
              }}
            >
              {t('reasonSkip')}
            </Button>
          </div>
        </fieldset>
      ) : null}

      {errorCode !== null ? <Callout tone="warning">{messageFor(errorCode)}</Callout> : null}

      {verdict === 'LOVE_IT' || verdict === 'MAYBE' ? (
        <Button asChild variant="link" size="sm" className="w-fit">
          <Link href={routes.shortlist(locale)}>{t('openShortlist')}</Link>
        </Button>
      ) : null}
    </section>
  );
}
