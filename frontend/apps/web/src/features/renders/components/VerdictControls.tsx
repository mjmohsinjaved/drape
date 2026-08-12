'use client';

import { useCallback, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Heart, HelpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Callout } from '@repo/ui';

import { recordVerdict } from '@/features/renders/api/endpoints';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { Verdict } from '@/features/renders/api/types';
import type { Locale } from '@/i18n/config';

export interface VerdictControlsProps {
  locale: Locale;
  resultId: string;
  /** Null once the garment has been hard-deleted — there is nothing left to have a verdict on. */
  garmentId: string | null;
  /** Joined from the shortlist. `undefined` when she has not decided yet. */
  current: Verdict | undefined;
}

/**
 * Love it / Maybe — C-20.
 *
 * Two equally weighted controls; neither is styled as the expected answer. "Not for me" and its
 * C-21 reason prompt were removed at the studio's request (2026-08) — walking away without
 * voting is the rejection now, and the API still accepts the old verdict for anything recorded
 * before the change.
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
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const save = useCallback(
    (next: Verdict): void => {
      if (garmentId === null) return;

      setPending(next);
      setErrorCode(null);

      void recordVerdict({ garmentId, verdict: next, resultId })
        .then(() => {
          setVerdict(next);
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
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">{t('heading')}</h2>
        <p className="text-sm text-ink-muted">{t('hint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      {errorCode !== null ? <Callout tone="warning">{messageFor(errorCode)}</Callout> : null}

      {verdict === 'LOVE_IT' || verdict === 'MAYBE' ? (
        <Button asChild variant="link" size="sm" className="w-fit">
          <Link href={routes.shortlist(locale)}>{t('openShortlist')}</Link>
        </Button>
      ) : null}
    </section>
  );
}
