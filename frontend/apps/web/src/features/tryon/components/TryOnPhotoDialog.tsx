'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Images } from 'lucide-react';
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
  DialogHeader,
  DialogTitle,
  IconButton,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from '@repo/ui';

import { activatePhoto, listPhotos } from '@/features/photos/api/endpoints';
import { PhotoUploader } from '@/features/photos/components/PhotoUploader';
import { useHiddenPhotos } from '@/features/tryon/hooks/use-hidden-photos';

import type { PersonPhoto } from '@/features/photos/api/types';
import type { Locale } from '@/i18n/config';

export interface TryOnPhotoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPicked: (photoId: string) => void;
  locale: Locale;
  returnTo: string;
}

export function TryOnPhotoDialog({
  open,
  onOpenChange,
  onPicked,
  locale,
  returnTo,
}: TryOnPhotoDialogProps) {
  const t = useTranslations('tryon.photoDialog');
  const tPhotos = useTranslations('photos');
  const format = useFormatter();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const { hidden, toggleHidden } = useHiddenPhotos();

  const photos = useQuery({
    queryKey: queryKeys.photos.list(),
    queryFn: ({ signal }) => listPhotos(signal),
    staleTime: STALE_TIMES.photos,
    enabled: open,
  });

  const activate = useMutation({
    mutationFn: (photoId: string) => activatePhoto(photoId),
    onSuccess: async (_data, photoId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.photos.all });
      onOpenChange(false);
      onPicked(photoId);
    },
  });

  const onAddOpenChange = (nextOpen: boolean): void => {
    setAddOpen(nextOpen);
    if (!nextOpen) void queryClient.invalidateQueries({ queryKey: queryKeys.photos.all });
  };

  const nameOf = (photo: PersonPhoto): string =>
    photo.label ??
    t('unnamed', { date: format.dateTime(new Date(photo.uploadedAt), 'short') });

  const all = photos.data ?? [];
  const usable = all.filter(
    (photo) => photo.moderationState !== 'BLOCKED' && !hidden.has(photo.id),
  );
  const active = usable.find((photo) => photo.isActive) ?? usable[0];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent closeLabel={t('close')}>
          <DialogHeader>
            <DialogTitle className="font-display">{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4 pb-6">
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                startIcon={<Images aria-hidden="true" />}
                onClick={() => {
                  setAddOpen(true);
                }}
              >
                {t('browseGallery')}
              </Button>
            </div>

            {photos.isPending ? (
              <div
                className="grid grid-cols-3 gap-3"
                aria-busy="true"
                aria-label={t('loading')}
              >
                <Skeleton className="aspect-card w-full rounded-md" />
                <Skeleton className="aspect-card w-full rounded-md" />
                <Skeleton className="aspect-card w-full rounded-md" />
              </div>
            ) : null}

            {photos.isError ? <Callout tone="warning">{t('loadFailed')}</Callout> : null}

            {photos.isSuccess && all.length === 0 ? (
              <Callout tone="info" title={t('none')}>
                {t('noneNote')}
              </Callout>
            ) : null}

            {photos.isSuccess && all.length > 0 ? (
              <ul
                className="grid grid-cols-3 gap-3"
                aria-busy={activate.isPending}
                aria-label={activate.isPending ? t('switching') : undefined}
              >
                {all.map((photo) => {
                  const blocked = photo.moderationState === 'BLOCKED';
                  const isHidden = hidden.has(photo.id);
                  const inUse = photo.id === active?.id && !isHidden;

                  return (
                    <li key={photo.id} className="flex flex-col gap-1">
                      <span className="group relative block">
                        <button
                          type="button"
                          disabled={blocked || isHidden || activate.isPending}
                          aria-current={inUse}
                          aria-label={
                            blocked || isHidden ? undefined : `${t('use')} — ${nameOf(photo)}`
                          }
                          onClick={() => {
                            activate.mutate(photo.id);
                          }}
                          className={`relative block aspect-card w-full overflow-hidden rounded-md border-2 bg-surface-sunken focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-default ${
                            inUse ? 'border-brand' : 'border-transparent hover:border-line-strong'
                          } ${blocked || isHidden ? 'opacity-50' : ''}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser. */}
                          <img
                            src={photo.url}
                            alt=""
                            loading="lazy"
                            className={`size-full object-cover ${isHidden ? 'blur-md' : ''}`}
                          />
                          {inUse ? (
                            <span className="absolute top-1 start-1">
                              <Badge variant="brand">
                                <Check aria-hidden="true" className="me-0.5 size-3" />
                                {t('inUse')}
                              </Badge>
                            </span>
                          ) : null}
                        </button>

                        {!blocked ? (
                          <span className="absolute end-1 top-1">
                            <IconButton
                              variant="secondary"
                              size="sm"
                              label={isHidden ? t('unhide') : t('hide')}
                              icon={
                                isHidden ? (
                                  <Eye aria-hidden="true" />
                                ) : (
                                  <EyeOff aria-hidden="true" />
                                )
                              }
                              onClick={() => {
                                toggleHidden(photo.id);
                              }}
                            />
                          </span>
                        ) : null}
                      </span>

                      <span className="truncate text-xs text-ink-muted">
                        {blocked ? t('blocked') : isHidden ? t('hiddenCaption') : nameOf(photo)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <p className="text-xs text-ink-subtle">{t('privacyNote')}</p>

            {activate.isError ? <Callout tone="warning">{t('failed')}</Callout> : null}
          </DialogBody>
        </DialogContent>
      </Dialog>

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
    </>
  );
}
