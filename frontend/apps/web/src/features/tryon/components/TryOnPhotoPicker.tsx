'use client';

import { useState } from 'react';

import Link from 'next/link';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { queryKeys, STALE_TIMES } from '@repo/api-client';
import {
  Badge,
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@repo/ui';

import { activatePhoto, listPhotos } from '@/features/photos/api/endpoints';
import { routes } from '@/lib/routes';

import type { PersonPhoto } from '@/features/photos/api/types';
import type { Locale } from '@/i18n/config';

export interface TryOnPhotoPickerProps {
  locale: Locale;
  /** Where to come back to after adding a photo. */
  returnTo: string;
}

/**
 * **Which photo this try-on will use, and how to change it — beside the button that spends it.**
 *
 * The photo was decidable in exactly one place: `/photos`. From a garment she had no way to see
 * which of her photographs the generation would use, and changing it meant leaving the piece,
 * switching the active photo, and finding her way back. The API has always accepted a photo per
 * request and `/person-photos/:id/activate` has always existed; nothing here is a new capability,
 * only a new place to reach one.
 *
 * ### Why it activates rather than passing `personPhotoId`
 *
 * `startTryOn` takes an optional `personPhotoId`, so this could scope the choice to one
 * generation and leave the active photo alone. It does not, deliberately: two ways to answer
 * "which photo am I using" is the complexity being removed, not added. Choosing here changes the
 * active photo, so the garment page, `/photos` and the next try-on all agree, and the answer
 * survives a reload.
 *
 * ### States
 *
 * All six of D-5 are reachable. Loading is a skeleton row rather than a spinner, because the
 * shape is known. Empty is the interesting one — a consumer with no photograph at all gets the
 * add-a-photo invitation here rather than discovering the requirement by pressing Try it on and
 * being bounced. A `BLOCKED` photograph is shown and disabled with neutral copy: it is listed
 * because hiding it would read as "your photo vanished", and the wording never says why, because
 * that would disclose the moderation outcome.
 */
export function TryOnPhotoPicker({ locale, returnTo }: TryOnPhotoPickerProps) {
  const t = useTranslations('tryon.photoPicker');
  // `start.usingPhoto` and `start.changePhoto` were already written for this panel and had no
  // reader until now.
  const tStart = useTranslations('tryon.start');
  const format = useFormatter();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);

  const photos = useQuery({
    queryKey: queryKeys.photos.list(),
    queryFn: ({ signal }) => listPhotos(signal),
    // Shared with `/photos`, so walking browse → garment → back is one request, not one per
    // piece. Every mutation that can change the list invalidates it, so the timer is a backstop.
    staleTime: STALE_TIMES.photos,
  });

  const activate = useMutation({
    mutationFn: (photoId: string) => activatePhoto(photoId),
    onSuccess: async () => {
      // The list is the only reader of `isActive`, and the try-on posts nothing about the photo,
      // so this is the whole invalidation.
      await queryClient.invalidateQueries({ queryKey: queryKeys.photos.all });
      setOpen(false);
    },
  });

  const nameOf = (photo: PersonPhoto): string =>
    photo.label ??
    t('unnamed', { date: format.dateTime(new Date(photo.uploadedAt), 'short') });

  if (photos.isPending) {
    return (
      <div className="flex items-center gap-3" aria-busy="true" aria-label={t('loading')}>
        <Skeleton className="size-12 shrink-0 rounded-lg" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }

  // A failed read must not hide the button below it: the API decides whether she may generate,
  // and it will use her active photo whether or not this panel managed to render.
  if (photos.isError || photos.data === undefined) {
    return null;
  }

  const all = photos.data;
  const usable = all.filter((photo) => photo.moderationState !== 'BLOCKED');
  const active = usable.find((photo) => photo.isActive) ?? usable[0];

  if (active === undefined) {
    return (
      <Callout
        tone="info"
        title={t('none')}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`${routes.photoNew(locale)}?from=${encodeURIComponent(returnTo)}`}>
              {t('addFirst')}
            </Link>
          </Button>
        }
      >
        {t('noneNote')}
      </Callout>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-sunken p-3">
      {/*
        A signed, 300-second, owner-scoped URL (§3.4). A plain <img> on purpose: the optimiser
        would cache a URL that expires, and the stale entry would 403.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser. */}
      <img
        src={active.url}
        alt=""
        className="size-12 shrink-0 rounded-lg object-cover"
        loading="lazy"
      />

      <p className="min-w-0 flex-1 truncate text-sm text-ink-muted">
        {tStart('usingPhoto', { label: nameOf(active) })}
      </p>

      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {tStart('changePhoto')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              aria-busy={activate.isPending}
              aria-label={activate.isPending ? t('switching') : undefined}
            >
              {all.map((photo) => {
                const blocked = photo.moderationState === 'BLOCKED';
                const inUse = photo.id === active.id;

                return (
                  <li key={photo.id}>
                    <button
                      type="button"
                      disabled={blocked || inUse || activate.isPending}
                      aria-current={inUse}
                      // The visible label is the photo's name, which says which one but not what
                      // pressing it does. D-20: a control's accessible name is the action.
                      aria-label={
                        blocked || inUse ? undefined : `${t('use')} — ${nameOf(photo)}`
                      }
                      onClick={() => {
                        activate.mutate(photo.id);
                      }}
                      className="group flex w-full flex-col gap-2 rounded-lg text-start focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-default"
                    >
                      <span
                        className={`relative block aspect-card w-full overflow-hidden rounded-lg border-2 bg-surface-sunken ${
                          inUse ? 'border-brand' : 'border-transparent group-hover:border-line-strong'
                        } ${blocked ? 'opacity-50' : ''}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL. */}
                        <img
                          src={photo.url}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                        {inUse ? (
                          <span className="absolute top-1.5 start-1.5">
                            <Badge variant="brand">
                              <Check aria-hidden="true" className="me-1 size-3" />
                              {t('inUse')}
                            </Badge>
                          </span>
                        ) : null}
                      </span>

                      <span className="truncate text-xs text-ink-muted">
                        {blocked ? t('blocked') : nameOf(photo)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {activate.isError ? (
              <Callout tone="warning" className="mt-3">
                {t('failed')}
              </Callout>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button asChild variant="secondary" startIcon={<Camera aria-hidden="true" />}>
              <Link href={`${routes.photoNew(locale)}?from=${encodeURIComponent(returnTo)}`}>
                {t('addAnother')}
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
