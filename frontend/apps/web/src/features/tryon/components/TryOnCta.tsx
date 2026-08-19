'use client';

import { useCallback, useState } from 'react';

import Link from 'next/link';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Heart, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { queryKeys, STALE_TIMES } from '@repo/api-client';
import { Button, Callout } from '@repo/ui';

import { listPhotos } from '@/features/photos/api/endpoints';
import { recordVerdict } from '@/features/renders/api/endpoints';
import { getShortlist } from '@/features/shortlist/api/endpoints';
import { listTryOnJobs } from '@/features/tryon/api/endpoints';
import { InlineTryOnProgress } from '@/features/tryon/components/InlineTryOnProgress';
import { BudgetExhausted, QuotaExhausted } from '@/features/tryon/components/QuotaExhausted';
import { TryOnPhotoDialog } from '@/features/tryon/components/TryOnPhotoDialog';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { useStartTryOn } from '@/features/tryon/hooks/use-start-tryon';
import {
  isBudgetExhausted,
  isQuotaExhausted,
  needsAnotherPhoto,
} from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface TryOnCtaProps {
  locale: Locale;
  garmentId: string;
  garmentTitle: string;
  catalogImageUrl?: string | null;
  catalogImageAlt: string;
  garmentThumbnailUrl?: string | null;
  isAuthenticated: boolean;
  returnTo: string;
}

export function TryOnCta({
  locale,
  garmentId,
  garmentTitle,
  catalogImageUrl,
  catalogImageAlt,
  garmentThumbnailUrl,
  isAuthenticated,
  returnTo,
}: TryOnCtaProps) {
  const t = useTranslations('tryon.start');
  const tCta = useTranslations('tryon.cta');
  const messageFor = useErrorMessage('tryon');
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [view, setView] = useState<'render' | 'catalog'>('render');
  /** A job that failed here. Kept apart from the start error so both can be shown the same way. */
  const [jobErrorCode, setJobErrorCode] = useState<string | null>(null);

  /**
   * The reveal. The applied-check query below is what draws the render on the piece, so a new
   * result is revealed by refetching it — there is no second copy of the render to keep in sync
   * and nothing to navigate to.
   */
  const revealApplied = useCallback(
    async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tryon.all });
    },
    [queryClient],
  );

  const { start, isStarting, errorCode, jobId, clearJob } = useStartTryOn({
    locale,
    returnTo,
    isAuthenticated,
    // C-18: the try-on happens on the piece she is looking at, start to finish (§10.3).
    stayOnPage: true,
    // A cache hit has no job to watch — the render already exists, so reveal it straight away.
    onSucceeded: () => {
      void revealApplied();
    },
  });

  const handleJobSucceeded = useCallback((): void => {
    // `clearJob` only after the refetch has landed, so the finished progress panel hands over
    // directly to the render instead of flashing the "Try it on" button in between.
    void (async () => {
      await revealApplied();
      clearJob();
    })();
  }, [clearJob, revealApplied]);

  const handleJobFailed = useCallback(
    (code: string): void => {
      setJobErrorCode(code);
      clearJob();
    },
    [clearJob],
  );

  const handleJobCancelled = useCallback((): void => {
    clearJob();
  }, [clearJob]);

  const photos = useQuery({
    queryKey: queryKeys.photos.list(),
    queryFn: ({ signal }) => listPhotos(signal),
    staleTime: STALE_TIMES.photos,
    enabled: isAuthenticated,
  });
  const activePhoto = photos.data?.find((photo) => photo.isActive);

  const succeeded = useQuery({
    queryKey: [...queryKeys.tryon.all, 'jobs', 'applied-check'],
    queryFn: ({ signal }) => listTryOnJobs({ status: 'SUCCEEDED', limit: 50 }, signal),
    enabled: isAuthenticated,
  });
  const appliedResult =
    activePhoto === undefined
      ? undefined
      : (succeeded.data?.items.find(
          (job) =>
            job.garmentId === garmentId &&
            job.result !== null &&
            job.result.personPhotoId === activePhoto.id,
        )?.result ?? undefined);
  const shortlist = useQuery({
    queryKey: queryKeys.shortlist.list(),
    queryFn: ({ signal }) => getShortlist(signal),
    enabled: isAuthenticated,
  });
  const loved =
    shortlist.data?.items.some(
      (item) => item.garmentId === garmentId && item.verdict === 'LOVE_IT',
    ) ?? false;

  const love = useMutation({
    mutationFn: () =>
      recordVerdict({ garmentId, verdict: 'LOVE_IT', resultId: appliedResult?.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.shortlist.all });
    },
  });

  const catalogHero =
    catalogImageUrl == null ? (
      <div className="aspect-card w-full rounded-xl bg-surface-sunken" />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- signed URL, must not be cached by the image optimiser.
      <img
        src={catalogImageUrl}
        alt={catalogImageAlt}
        className="aspect-card w-full rounded-xl bg-surface-sunken object-cover shadow-xs"
      />
    );

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-3">
        {catalogHero}
        <Button asChild variant="primary" fullWidth>
          <Link href={`${routes.login(locale)}?from=${encodeURIComponent(returnTo)}`}>
            {t('signIn')}
          </Link>
        </Button>
        <p className="text-sm text-ink-muted">{t('signInNote')}</p>
      </div>
    );
  }

  // A refusal at start and a job that failed mid-flight are the same thing to her.
  const failureCode = errorCode ?? jobErrorCode;

  if (failureCode !== null && isQuotaExhausted(failureCode)) {
    return (
      <div className="flex flex-col gap-3">
        {catalogHero}
        <QuotaExhausted locale={locale} />
      </div>
    );
  }
  if (failureCode !== null && isBudgetExhausted(failureCode)) {
    return (
      <div className="flex flex-col gap-3">
        {catalogHero}
        <BudgetExhausted locale={locale} />
      </div>
    );
  }

  const dialog = (
    <TryOnPhotoDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      locale={locale}
      returnTo={returnTo}
      onPicked={(photoId) => {
        setJobErrorCode(null);
        start({ garmentId, garmentTitle, garmentThumbnailUrl, personPhotoId: photoId });
      }}
    />
  );

  const progressPanel =
    jobId === null ? null : (
      <InlineTryOnProgress
        jobId={jobId}
        onSucceeded={handleJobSucceeded}
        onFailed={handleJobFailed}
        onCancelled={handleJobCancelled}
      />
    );

  // A try-on already in flight replaces the applied view: she asked for a new one, and showing
  // the previous render as though it were the answer would be a lie for the next few seconds.
  if (appliedResult !== undefined && !isStarting && jobId === null) {
    const showRender = view === 'render';
    const segment = (key: 'render' | 'catalog', label: string): React.JSX.Element => (
      <button
        type="button"
        aria-pressed={view === key}
        onClick={() => {
          setView(key);
        }}
        className={`flex-1 px-3 py-2 text-sm font-bold transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
          view === key ? 'bg-brand text-brand-fg' : 'bg-surface text-ink hover:bg-surface-sunken'
        }`}
      >
        {label}
      </button>
    );

    return (
      <div className="flex flex-col gap-2">
        {/* The 4a compare, on top of the image — never a separate page. */}
        <div className="flex overflow-hidden rounded-lg border border-line-strong">
          {segment('render', tCta('onYourPhoto'))}
          {segment('catalog', tCta('catalog'))}
        </div>

        <div className="relative">
          {showRender ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser.
            <img
              src={appliedResult.url}
              alt={tCta('renderAlt', { garment: garmentTitle })}
              className="aspect-card w-full rounded-xl bg-surface-sunken object-contain shadow-xs"
            />
          ) : (
            catalogHero
          )}

          <button
            type="button"
            aria-pressed={loved}
            aria-label={loved ? tCta('loved') : tCta('loveIt')}
            disabled={love.isPending || loved}
            onClick={() => {
              love.mutate();
            }}
            className="absolute start-2 top-2 inline-flex size-9 items-center justify-center rounded-full bg-canvas/95 shadow-xs transition-colors duration-fast hover:bg-canvas focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-default"
          >
            {loved ? (
              <Check aria-hidden="true" className="size-4 text-brand" />
            ) : (
              <Heart aria-hidden="true" className="size-4 text-brand" />
            )}
          </button>
        </div>

        <Button
          type="button"
          disabled
          fullWidth
          startIcon={<Check aria-hidden="true" />}
          className="bg-success text-brand-fg disabled:opacity-100"
        >
          {tCta('applied')}
        </Button>
        <p className="text-center text-sm text-ink-muted">{tCta('appliedNote')}</p>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          {t('changePhoto')}
        </Button>

        {/* A try-on that failed after a render was already applied — the old one stays visible. */}
        {failureCode !== null ? (
          <Callout tone="warning">{messageFor(failureCode)}</Callout>
        ) : null}

        {love.isError ? <Callout tone="warning">{tCta('loveFailed')}</Callout> : null}

        {dialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {catalogHero}

      {progressPanel ?? (
        <>
          <Button
            type="button"
            variant="primary"
            fullWidth
            loading={isStarting}
            loadingLabel={t('starting')}
            startIcon={<Sparkles aria-hidden="true" />}
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            {t('action')}
          </Button>

          <p className="text-center text-sm text-ink-muted">{tCta('note')}</p>
        </>
      )}

      {failureCode !== null ? (
        <Callout
          tone="warning"
          action={
            needsAnotherPhoto(failureCode) ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`${routes.photoNew(locale)}?from=${encodeURIComponent(returnTo)}`}>
                  {t('needsPhoto')}
                </Link>
              </Button>
            ) : undefined
          }
        >
          {messageFor(failureCode)}
        </Callout>
      ) : null}

      {dialog}
    </div>
  );
}
