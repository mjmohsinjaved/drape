'use client';

import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TypeToConfirmDialog,
} from '@repo/ui';

import type { AdminCategory } from '@/features/categories/types/admin-categories';

export interface CategoryDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: AdminCategory;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
  busy: boolean;
}

/**
 * A-7 — "a category holding published garments cannot be deleted, only archived."
 *
 * When the API says the category is not deletable, this is **not** an error screen. Nothing has
 * gone wrong: the rule is doing its job, and the admin needs to know which pieces are keeping the
 * category alive and what to do instead. So the dialog explains the count, names archiving as the
 * action that is actually available, and offers it in place of the refused one — rather than
 * letting the admin press Delete and read a failure afterwards (D-7).
 *
 * When it *is* deletable, deletion is permanent, so the name has to be typed (D-17).
 */
export function CategoryDeleteDialog({
  open,
  onOpenChange,
  category,
  onDelete,
  onArchive,
  busy,
}: CategoryDeleteDialogProps) {
  const t = useTranslations('admin.categories.delete');

  if (!category.deletable) {
    const heldCount = category.publishedGarmentCountIncludingChildren;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('blockedTitle', { name: category.name })}</DialogTitle>
            <DialogDescription>{t('blockedBody', { count: heldCount })}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Callout tone="info" title={t('archiveInsteadTitle')}>
              {category.archived ? t('alreadyArchived') : t('archiveInsteadBody')}
            </Callout>
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('close')}
            </Button>
            {!category.archived && (
              <Button
                variant="primary"
                loading={busy}
                loadingLabel={t('archive')}
                onClick={() => void onArchive()}
              >
                {t('archive')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <TypeToConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { name: category.name })}
      description={t('body', { name: category.name })}
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      confirmationText={category.name}
      confirmationPrompt={t('typePrompt')}
      confirmationMismatchHint={t('mismatch')}
      loading={busy}
      onConfirm={onDelete}
    />
  );
}
