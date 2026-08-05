'use client';

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';

import { Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  isJobActive,
  useTrayJobsNewestFirst,
  useTrayOpen,
  useTrayUnseenCount,
  useTryOnTrayActions,
  type TrayJob,
} from '@repo/store';
import { Badge, Button, IconButton, ImageWithFallback, Spinner } from '@repo/ui';

import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { useTrayReconciler } from '@/features/tryon/hooks/use-tray-reconciler';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface TryOnTrayProps {
  /** Every link out of the tray is locale-prefixed, so the active locale is passed in. */
  locale: Locale;
}

/**
 * The results tray — PRD C-19.
 *
 * > "She can keep browsing; results collect in a tray and notify inline."
 *
 * A fixed, dismissible panel that follows her across the browse surface. Its rows come entirely
 * from `useTryOnTrayStore` (`sessionStorage`), so it survives a reload mid-generation — a `fetch`
 * inside a store is a review failure (§6.5).
 *
 * **It owns reconciliation.** `useTrayReconciler` polls the active rows on the §6.4 interval,
 * because the tray is the thing that follows her: the wait screen used to be the only writer of
 * terminal state, so taking its own "Keep browsing" action left the job spinning here forever.
 * See the note on that hook.
 *
 * The notification is **inline**: a live region announces a finished job once, and the launcher
 * carries an unseen count. There is no toast that can be missed and no browser notification
 * permission prompt.
 *
 * ═══ Why there is no `hasHydrated` gate here ═══
 *
 * A component that renders from `sessionStorage` normally needs one: the server has no storage,
 * so the two trees disagree. This one does not, and the reason is worth writing down because the
 * shape of the code says otherwise. zustand v5 passes `api.getInitialState` to
 * `useSyncExternalStore` as the **server snapshot**, and `getInitialState` is captured before
 * `persist`'s synchronous rehydration lands — so React's hydration pass sees `jobs = {}`, exactly
 * what the server rendered, and picks up the real rows on the commit after. Adding a mounted flag
 * would cost a frame of blank tray and fix nothing. `TryOnTray.test.tsx` hydrates a real server
 * render against a populated `sessionStorage` and asserts zero recoverable errors, so if the
 * store ever stops going through zustand — or zustand stops doing this — the suite says so.
 */
export function TryOnTray({ locale }: TryOnTrayProps) {
  const t = useTranslations('tryon.tray');
  const messageFor = useErrorMessage('tryon');
  const jobs = useTrayJobsNewestFirst();
  const open = useTrayOpen();
  const unseen = useTrayUnseenCount();
  const { setTrayOpen, dismissJob, markAllSeen, clearFinished } = useTryOnTrayActions();
  useTrayReconciler();

  const [announcement, setAnnouncement] = useState('');
  const announcedRef = useRef<Set<string>>(new Set());

  /**
   * One announcement per job, the first time it reaches a terminal state. Re-announcing on every
   * render would make the live region unusable, and a job she has already opened is not news —
   * `seen` is what tells the two apart across a navigation, since the ref is per mount.
   */
  useEffect(() => {
    for (const job of jobs) {
      if (isJobActive(job) || job.seen || announcedRef.current.has(job.jobId)) continue;
      announcedRef.current.add(job.jobId);

      if (job.status === 'SUCCEEDED') {
        setAnnouncement(t('announceReady', { garment: job.garmentTitle }));
      } else if (job.status === 'FAILED') {
        setAnnouncement(t('announceFailed', { garment: job.garmentTitle }));
      }
    }
  }, [jobs, t]);

  if (jobs.length === 0) return null;

  const activeCount = jobs.filter(isJobActive).length;

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {open ? (
        <aside
          aria-label={t('label')}
          className="fixed bottom-0 end-0 z-40 w-full max-w-sm p-4 pb-tabbar md:pb-4"
        >
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-md">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium">{t('heading')}</h2>
              <IconButton
                size="sm"
                variant="ghost"
                label={t('close')}
                icon={<X />}
                onClick={() => {
                  setTrayOpen(false);
                  markAllSeen();
                }}
              />
            </div>

            <ul className="flex flex-col gap-3">
              {jobs.slice(0, 5).map((job) => (
                <li key={job.jobId}>
                  <TrayRow
                    job={job}
                    locale={locale}
                    messageFor={messageFor}
                    onDismiss={() => {
                      dismissJob(job.jobId);
                    }}
                  />
                </li>
              ))}
            </ul>

            {activeCount < jobs.length ? (
              <Button type="button" variant="link" size="sm" onClick={clearFinished}>
                {t('clearFinished')}
              </Button>
            ) : null}
          </div>
        </aside>
      ) : (
        <div className="fixed bottom-0 end-0 z-40 p-4 pb-tabbar md:pb-4">
          <Button
            type="button"
            variant="secondary"
            startIcon={
              activeCount > 0 ? (
                <Spinner size="sm" label={null} />
              ) : (
                <Sparkles aria-hidden="true" />
              )
            }
            onClick={() => {
              setTrayOpen(true);
            }}
          >
            {unseen > 0 ? t('openWithCount', { count: unseen }) : t('open')}
          </Button>
        </div>
      )}
    </>
  );
}

function TrayRow({
  job,
  locale,
  messageFor,
  onDismiss,
}: {
  job: TrayJob;
  locale: Locale;
  messageFor: (error: unknown) => string;
  onDismiss: () => void;
}) {
  const t = useTranslations('tryon.tray');
  const active = isJobActive(job);

  return (
    <div className="flex items-start gap-3">
      <div className="w-16 shrink-0">
        {job.thumbnailUrl ?? job.garmentThumbnailUrl ? (
          <ImageWithFallback
            ratio="garment"
            rounded="md"
            src={job.thumbnailUrl ?? job.garmentThumbnailUrl ?? ''}
            alt={t('thumbnailAlt', { garment: job.garmentTitle })}
            sizes="64px"
            fallbackLabel={t('thumbnailAlt', { garment: job.garmentTitle })}
          />
        ) : (
          <div className="aspect-card w-full rounded-md bg-surface-sunken" aria-hidden="true" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium">{job.garmentTitle}</p>

        {active ? (
          <p className="text-xs text-ink-muted">{t('inProgress')}</p>
        ) : job.status === 'SUCCEEDED' ? (
          <Badge variant="success" size="sm">
            {t('ready')}
          </Badge>
        ) : job.status === 'CANCELLED' ? (
          <p className="text-xs text-ink-muted">{t('cancelled')}</p>
        ) : (
          <p className="text-xs text-ink-muted">{messageFor(job.errorCode)}</p>
        )}

        {job.status === 'SUCCEEDED' && job.resultId !== null ? (
          <Button asChild variant="link" size="sm">
            <Link href={routes.render(locale, job.resultId)}>{t('view')}</Link>
          </Button>
        ) : null}
        {active ? (
          <Button asChild variant="link" size="sm">
            <Link href={routes.tryOnJob(locale, job.jobId)}>{t('view')}</Link>
          </Button>
        ) : null}
      </div>

      <IconButton size="sm" variant="ghost" label={t('dismiss')} icon={<X />} onClick={onDismiss} />
    </div>
  );
}
