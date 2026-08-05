'use client';

import { useCallback, useState } from 'react';

import { Pencil, Star, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  IconButton,
  Input,
  Label,
} from '@repo/ui';

import { activatePhoto, deletePhoto, renamePhoto } from '@/features/photos/api/endpoints';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';
import { useRouter } from '@/i18n/navigation';

import type { PersonPhoto } from '@/features/photos/api/types';

export interface PhotoListProps {
  photos: PersonPhoto[];
}

type Busy = { id: string; action: 'activate' | 'rename' | 'delete' } | null;

/**
 * Her saved photos — C-16.
 *
 * > "She may hold multiple saved photos and choose which is active."
 *
 * Which is the whole model: one active photo, any number of saved ones, and switching is one
 * tap. The copy says what switching *does* — the next try-on uses it — rather than describing a
 * flag.
 *
 * Deletion says the true thing and only the true thing (C-16, C-28): the photo and its file go
 * immediately, and **her renders stay**. A confirmation that implied otherwise would be the
 * worst kind of wrong here, because she would decline a deletion she actually wanted.
 *
 * `router.refresh()` after each mutation, because the list is server-rendered from a signed,
 * five-minute URL — refetching through the server is what keeps the image links live.
 */
export function PhotoList({ photos }: PhotoListProps) {
  const t = useTranslations('photos.list');
  const messageFor = useErrorMessage('photos');
  const format = useFormatter();
  const router = useRouter();

  const [busy, setBusy] = useState<Busy>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PersonPhoto | null>(null);

  const run = useCallback(
    (id: string, action: NonNullable<Busy>['action'], work: () => Promise<unknown>): void => {
      setBusy({ id, action });
      setErrorCode(null);
      void work()
        .then(() => {
          router.refresh();
        })
        .catch((error: unknown) => {
          setErrorCode(resolveErrorCode(error));
        })
        .finally(() => {
          setBusy(null);
        });
    },
    [router],
  );

  return (
    <div className="flex flex-col gap-6">
      {errorCode !== null ? <Callout tone="danger">{messageFor(errorCode)}</Callout> : null}

      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6">
        {photos.map((photo) => {
          const name = photo.label ?? t('unnamed', {
            date: format.dateTime(new Date(photo.uploadedAt), 'short'),
          });

          return (
            <li key={photo.id} className="flex flex-col gap-3">
              <div className="relative aspect-card w-full overflow-hidden rounded-xl bg-surface-sunken">
                {/*
                  A signed, 300-second, owner-scoped URL (§3.4). Deliberately a plain <img>: the
                  optimiser would cache a URL that expires, and a stale entry would 403.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser. */}
                <img
                  src={photo.url}
                  alt={t('photoAlt', { label: name })}
                  className="size-full object-cover"
                  loading="lazy"
                />
                {photo.isActive ? (
                  <span className="absolute top-2 start-2">
                    <Badge variant="brand">{t('active')}</Badge>
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                {renaming === photo.id ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`rename-${photo.id}`}>{t('renameLabel')}</Label>
                    <Input
                      id={`rename-${photo.id}`}
                      value={draftLabel}
                      maxLength={60}
                      placeholder={t('renamePlaceholder')}
                      onChange={(event) => {
                        setDraftLabel(event.target.value);
                      }}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        loading={busy?.id === photo.id && busy.action === 'rename'}
                        onClick={() => {
                          const next = draftLabel.trim();
                          setRenaming(null);
                          run(photo.id, 'rename', () =>
                            renamePhoto(photo.id, { label: next === '' ? null : next }),
                          );
                        }}
                      >
                        {t('renameSave')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRenaming(null);
                        }}
                      >
                        {t('deleteDialog.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="truncate text-sm font-medium">{name}</p>
                )}

                <p className="text-xs text-ink-subtle">
                  {t('uploadedOn', {
                    date: format.dateTime(new Date(photo.uploadedAt), 'short'),
                  })}
                </p>
                <p className="text-xs text-ink-subtle">
                  {t('keptUntil', {
                    date: format.dateTime(new Date(photo.purgeAfter), 'short'),
                  })}
                </p>

                {photo.moderationState !== 'APPROVED' ? (
                  <Callout tone={photo.moderationState === 'BLOCKED' ? 'warning' : 'info'}>
                    {t(`moderation.${photo.moderationState}Hint`)}
                  </Callout>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {photo.isActive ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    startIcon={<Star aria-hidden="true" />}
                    loading={busy?.id === photo.id && busy.action === 'activate'}
                    loadingLabel={t('activating')}
                    onClick={() => {
                      run(photo.id, 'activate', () => activatePhoto(photo.id));
                    }}
                  >
                    {t('makeActive')}
                  </Button>
                )}

                <IconButton
                  size="md"
                  variant="ghost"
                  label={t('rename')}
                  icon={<Pencil />}
                  onClick={() => {
                    setRenaming(photo.id);
                    setDraftLabel(photo.label ?? '');
                  }}
                />

                <IconButton
                  size="md"
                  variant="ghost"
                  label={t('delete')}
                  icon={<Trash2 />}
                  onClick={() => {
                    setPendingDelete(photo);
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('deleteDialog.title')}
        description={t('deleteDialog.body')}
        confirmLabel={t('deleteDialog.confirm')}
        cancelLabel={t('deleteDialog.cancel')}
        tone="danger"
        loading={busy?.action === 'delete'}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target === null) return;
          run(target.id, 'delete', () => deletePhoto(target.id));
        }}
      />
    </div>
  );
}
