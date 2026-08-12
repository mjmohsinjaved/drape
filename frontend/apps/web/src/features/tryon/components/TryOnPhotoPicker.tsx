'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImagePlus, Images } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { queryKeys, STALE_TIMES } from '@repo/api-client';
import {
  Badge,
  Button,
  Callout,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Toolbar,
  ToolbarButton,
} from '@repo/ui';

import { activatePhoto, listPhotos } from '@/features/photos/api/endpoints';
import { PhotoUploader } from '@/features/photos/components/PhotoUploader';

import type { PersonPhoto } from '@/features/photos/api/types';
import type { Locale } from '@/i18n/config';

export interface TryOnPhotoPickerProps {
  locale: Locale;
  /** Where the C-15 uploader sends her after saving, were she to follow its links. */
  returnTo: string;
}

/**
 * **Which photo this try-on will use, and how to change it — without ever leaving the piece.**
 *
 * A small icon toolbar at the start of the screen: *your photos* opens an anchored panel with
 * the photo grid, *add a photo* opens the C-13/C-14/C-15 flow in a side sheet on this same
 * screen. Neither is a navigation — the garment stays visible behind both, which is the point:
 * choosing or adding a photograph is preparation for the try-on, not a trip away from it.
 *
 * ### Why it activates rather than passing `personPhotoId`
 *
 * `startTryOn` takes an optional `personPhotoId`, so this could scope the choice to one
 * generation and leave the active photo alone. It does not, deliberately: two ways to answer
 * "which photo am I using" is the complexity being removed, not added. Choosing here changes the
 * active photo, so the garment page, `/photos` and the next try-on all agree, and the answer
 * survives a reload. Selection applies immediately and the panel stays open — she can flip
 * between photographs and watch the *in use* mark move.
 *
 * ### States
 *
 * All six of D-5 are reachable. Loading is a skeleton toolbar rather than a spinner, because the
 * shape is known. Empty is the interesting one — a consumer with no photograph at all gets the
 * add-a-photo invitation here rather than discovering the requirement by pressing Try it on and
 * being bounced. A `BLOCKED` photograph is shown and disabled with neutral copy: it is listed
 * because hiding it would read as "your photo vanished", and the wording never says why, because
 * that would disclose the moderation outcome.
 */
export function TryOnPhotoPicker({ locale, returnTo }: TryOnPhotoPickerProps) {
  const t = useTranslations('tryon.photoPicker');
  const tStart = useTranslations('tryon.start');
  const tPhotos = useTranslations('photos');
  const format = useFormatter();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);

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
      // so this is the whole invalidation. The panel stays open on purpose: the *in use* badge
      // moving to the photograph she chose is the confirmation.
      await queryClient.invalidateQueries({ queryKey: queryKeys.photos.all });
    },
  });

  /*
    The uploader manages its whole flow internally and exposes no saved-callback, so the moment
    the sheet closes is when this screen re-reads the list. A close without an upload costs one
    background refetch; a close after one is what makes the new photograph appear — already
    active, because the C-16 default is to activate it.
  */
  const onAddOpenChange = (open: boolean): void => {
    setAddOpen(open);
    if (!open) void queryClient.invalidateQueries({ queryKey: queryKeys.photos.all });
  };

  const nameOf = (photo: PersonPhoto): string =>
    photo.label ??
    t('unnamed', { date: format.dateTime(new Date(photo.uploadedAt), 'short') });

  if (photos.isPending) {
    return (
      <div className="flex items-center gap-2" aria-busy="true" aria-label={t('loading')}>
        <Skeleton className="size-8 shrink-0 rounded-sm" />
        <Skeleton className="size-8 shrink-0 rounded-sm" />
        <Skeleton className="h-4 w-40" />
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

  const addSheet = (
    <Sheet open={addOpen} onOpenChange={onAddOpenChange}>
      <SheetContent side="end" className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{tPhotos('meta.newTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-6">
          <PhotoUploader locale={locale} isFirstPhoto={all.length === 0} returnTo={returnTo} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );

  if (active === undefined) {
    return (
      <>
        <Callout
          tone="info"
          title={t('none')}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              startIcon={<ImagePlus aria-hidden="true" />}
              onClick={() => {
                setAddOpen(true);
              }}
            >
              {t('addFirst')}
            </Button>
          }
        >
          {t('noneNote')}
        </Callout>
        {addSheet}
      </>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Toolbar aria-label={t('title')} className="shrink-0 flex-nowrap gap-1">
        <Popover>
          <ToolbarButton asChild>
            <PopoverTrigger asChild>
              <IconButton
                variant="secondary"
                size="sm"
                label={tStart('changePhoto')}
                icon={<Images aria-hidden="true" />}
              />
            </PopoverTrigger>
          </ToolbarButton>

          <PopoverContent align="start" className="panel-scroll w-96">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{t('title')}</p>
                <p className="text-xs text-ink-muted">{t('description')}</p>
              </div>

              <ul
                className="grid grid-cols-3 gap-2"
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
                        // The visible label is the photo's name, which says which one but not
                        // what pressing it does. D-20: a control's accessible name is the action.
                        aria-label={
                          blocked || inUse ? undefined : `${t('use')} — ${nameOf(photo)}`
                        }
                        onClick={() => {
                          activate.mutate(photo.id);
                        }}
                        className="group flex w-full flex-col gap-1 rounded-md text-start focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-default"
                      >
                        <span
                          className={`relative block aspect-card w-full overflow-hidden rounded-md border-2 bg-surface-sunken ${
                            inUse
                              ? 'border-brand'
                              : 'border-transparent group-hover:border-line-strong'
                          } ${blocked ? 'opacity-50' : ''}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL. */}
                          <img
                            src={photo.url}
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                          />
                          {/* Badge stays `md`: `sm` is `text-2xs`, which §6.1 keeps admin-only. */}
                          {inUse ? (
                            <span className="absolute top-1 start-1">
                              <Badge variant="brand">
                                <Check aria-hidden="true" className="me-0.5 size-3" />
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

              {activate.isError ? <Callout tone="warning">{t('failed')}</Callout> : null}
            </div>
          </PopoverContent>
        </Popover>

        <ToolbarButton asChild>
          <IconButton
            variant="secondary"
            size="sm"
            label={t('addAnother')}
            icon={<ImagePlus aria-hidden="true" />}
            onClick={() => {
              setAddOpen(true);
            }}
          />
        </ToolbarButton>
      </Toolbar>

      {/*
        A signed, 300-second, owner-scoped URL (§3.4). A plain <img> on purpose: the optimiser
        would cache a URL that expires, and the stale entry would 403.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser. */}
      <img
        src={active.url}
        alt=""
        className="size-8 shrink-0 rounded-sm object-cover"
        loading="lazy"
      />

      <p className="min-w-0 flex-1 truncate text-sm text-ink-muted">
        {tStart('usingPhoto', { label: nameOf(active) })}
      </p>

      {addSheet}
    </div>
  );
}
