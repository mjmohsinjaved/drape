'use client';

import { useEffect, useRef, useState } from 'react';

import { ImagePlus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormControl,
  FormError,
  FormField,
  FormHint,
  FormLabel,
  Input,
  ProgressBar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@repo/ui';
import { slugify } from '@repo/utils';

import { SignedImage } from '@/features/catalog/components/SignedImage';
import { useCatalogErrorCopy } from '@/features/catalog/hooks/use-catalog-error';
import { ACCEPTED_IMAGE_MIME_TYPES } from '@/features/catalog/types/admin-catalog';
import { useCategoryCoverUpload } from '@/features/categories/hooks/use-category-cover';
import {
  CATEGORY_SLUG_PATTERN,
  MAX_CATEGORY_NAME_LENGTH,
  type AdminCategory,
  type CreateCategoryBody,
  type UpdateCategoryBody,
} from '@/features/categories/types/admin-categories';

import type { Uuid } from '@repo/api-client';

export interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent for a create. */
  category?: AdminCategory;
  /** Root categories, for the parent picker. A-5 caps the tree at one level. */
  rootCategories: readonly AdminCategory[];
  /** Pre-selects a parent when the dialog was opened from "Add a sub-category". */
  defaultParentId?: Uuid | null;
  onCreate: (body: CreateCategoryBody) => Promise<void>;
  onUpdate: (categoryId: Uuid, body: UpdateCategoryBody) => Promise<void>;
  saving: boolean;
}

interface FieldErrors {
  name?: string;
  slug?: string;
}

/** Radix `Select` has no empty value, so "no parent" needs a sentinel of its own. */
const ROOT_OPTION = '__root__';

/**
 * Create and edit, in one dialog because they ask for the same six things.
 *
 * Two rules are expressed rather than enforced afterwards:
 *
 * - **A-5, one level deep.** The parent picker only ever lists root categories, and a category
 *   that already has children cannot be given a parent — the option simply is not offered, with
 *   the reason stated, instead of the API answering `CATEGORY_DEPTH_EXCEEDED` after the save.
 * - **A-6, the cover image.** `CATEGORY_COVER` upload tickets are scoped to a category id, so a
 *   cover can only be attached to a category that exists. The create form says where the cover
 *   is added rather than offering a control that would fail.
 */
export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  rootCategories,
  defaultParentId = null,
  onCreate,
  onUpdate,
  saving,
}: CategoryFormDialogProps) {
  const t = useTranslations('admin.categories.form');
  const errorCopy = useCatalogErrorCopy();
  const cover = useCategoryCoverUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEdit = category !== undefined;

  const [name, setName] = useState('');
  const [nameUr, setNameUr] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [parentId, setParentId] = useState<Uuid | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [coverCleared, setCoverCleared] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Destructured because the hook returns a fresh object each render but stable callbacks; the
  // effect below depends on the callback, not on the wrapper.
  const { reset: resetCover, upload: uploadCover } = cover;

  // Reset every time the dialog opens, so a previous edit never bleeds into the next one.
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setNameUr(category?.nameUr ?? '');
    setSlug(category?.slug ?? '');
    setSlugTouched(isEdit);
    setParentId(category ? category.parentId : defaultParentId);
    setCoverKey(null);
    setCoverCleared(false);
    setErrors({});
    resetCover();
  }, [open, category, defaultParentId, isEdit, resetCover]);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  /** A-5: a node with children can never become a child itself. */
  const canReparent = !isEdit || category.children.length === 0;
  const parentOptions = rootCategories.filter((node) => node.id !== category?.id && !node.archived);

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (name.trim().length === 0) next.name = t('nameRequired');
    else if (name.trim().length > MAX_CATEGORY_NAME_LENGTH) next.name = t('nameTooLong');
    if (effectiveSlug.length > 0 && !CATEGORY_SLUG_PATTERN.test(effectiveSlug)) {
      next.slug = t('slugShape');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleCoverPick = async (file: File | undefined): Promise<void> => {
    if (!file || !category) return;
    const key = await uploadCover(category.id, file);
    if (key === null) {
      toast.error(errorCopy.fromCode(cover.errorCode));
      return;
    }
    setCoverKey(key);
    setCoverCleared(false);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!validate()) return;

    if (isEdit) {
      const body: UpdateCategoryBody = {
        name: name.trim(),
        nameUr: nameUr.trim() === '' ? null : nameUr.trim(),
        slug: effectiveSlug === category.slug ? undefined : effectiveSlug,
        parentId: canReparent ? parentId : undefined,
      };
      if (coverKey !== null) body.coverImageKey = coverKey;
      else if (coverCleared) body.coverImageKey = null;
      await onUpdate(category.id, body);
      return;
    }

    const body: CreateCategoryBody = {
      name: name.trim(),
      ...(nameUr.trim() === '' ? {} : { nameUr: nameUr.trim() }),
      ...(effectiveSlug === '' ? {} : { slug: effectiveSlug }),
      ...(parentId === null ? {} : { parentId }),
    };
    await onCreate(body);
  };

  const currentCoverUrl = coverCleared ? null : (category?.coverImageUrl ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('editTitle', { name: category.name }) : t('createTitle')}
          </DialogTitle>
          <DialogDescription>{isEdit ? t('editBody') : t('createBody')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <FormField required>
            <FormLabel>{t('name')}</FormLabel>
            <FormControl>
              <Input
                value={name}
                maxLength={MAX_CATEGORY_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('namePlaceholder')}
              />
            </FormControl>
            <FormHint>{t('nameHint')}</FormHint>
            <FormError>{errors.name}</FormError>
          </FormField>

          <FormField>
            <FormLabel>{t('nameUr')}</FormLabel>
            <FormControl>
              <Input
                value={nameUr}
                lang="ur"
                dir="rtl"
                maxLength={MAX_CATEGORY_NAME_LENGTH}
                onChange={(event) => setNameUr(event.target.value)}
              />
            </FormControl>
            <FormHint>{t('nameUrHint')}</FormHint>
          </FormField>

          <FormField>
            <FormLabel>{t('slug')}</FormLabel>
            <FormControl>
              <Input
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
              />
            </FormControl>
            <FormHint>{t('slugHint')}</FormHint>
            <FormError>{errors.slug}</FormError>
          </FormField>

          <FormField disabled={!canReparent}>
            <FormLabel>{t('parent')}</FormLabel>
            <Select
              value={parentId ?? ROOT_OPTION}
              onValueChange={(value) => setParentId(value === ROOT_OPTION ? null : value)}
              disabled={!canReparent}
            >
              {/* `FormControl` wires the trigger, not the Radix root — the root renders no DOM. */}
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={t('parentRoot')} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={ROOT_OPTION}>{t('parentRoot')}</SelectItem>
                {parentOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormHint>{canReparent ? t('parentHint') : t('parentLocked')}</FormHint>
          </FormField>

          {isEdit ? (
            <FormField>
              <FormLabel>{t('cover')}</FormLabel>
              <div className="flex flex-wrap items-center gap-3">
                {currentCoverUrl !== null && coverKey === null ? (
                  <SignedImage
                    src={currentCoverUrl}
                    alt=""
                    ratio="landscape"
                    rounded="md"
                    className="w-24 border border-line"
                    fallbackLabel={t('coverUnavailable')}
                    emptyLabel={t('coverNone')}
                  />
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  startIcon={<ImagePlus aria-hidden="true" className="size-4" />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={cover.status === 'uploading'}
                >
                  {coverKey !== null ? t('coverReplaceReady') : t('coverChoose')}
                </Button>
                {(currentCoverUrl !== null || coverKey !== null) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    startIcon={<Trash2 aria-hidden="true" className="size-4" />}
                    onClick={() => {
                      setCoverKey(null);
                      setCoverCleared(true);
                    }}
                  >
                    {t('coverRemove')}
                  </Button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_MIME_TYPES.join(',')}
                className="hidden"
                onChange={(event) => {
                  void handleCoverPick(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {cover.status === 'uploading' ? (
                <ProgressBar size="sm" value={cover.progress} label={t('coverUploading')} />
              ) : null}
              <FormHint>{t('coverHint')}</FormHint>
            </FormField>
          ) : (
            <p className="rounded-md border border-line bg-surface-sunken p-3 text-xs text-ink-muted">
              {t('coverAfterCreate')}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            loadingLabel={isEdit ? t('save') : t('create')}
            onClick={() => void handleSubmit()}
          >
            {isEdit ? t('save') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
