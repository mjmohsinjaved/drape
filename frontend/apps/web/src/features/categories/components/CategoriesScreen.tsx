'use client';

import { useCallback, useMemo, useState } from 'react';

import {
  ArchiveRestore,
  ArchiveX,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  PermissionDeniedState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  VisuallyHidden,
  cn,
  toast,
} from '@repo/ui';

import { SignedOutState } from '@/components/states';
import { AdminPage, AdminPageHeader } from '@/features/catalog/components/AdminPage';
import { SignedImage } from '@/features/catalog/components/SignedImage';
import {
  isPermissionDenied,
  isSignedOut,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import { CategoryDeleteDialog } from '@/features/categories/components/CategoryDeleteDialog';
import { CategoryFormDialog } from '@/features/categories/components/CategoryFormDialog';
import {
  useAdminCategories,
  useArchiveCategory,
  useCreateCategory,
  useDeleteCategory,
  useReorderCategories,
  useUpdateCategory,
} from '@/features/categories/hooks/use-categories';
import {
  flattenCategoryTree,
  moveWithin,
  type AdminCategory,
  type CategoryTreeRow,
  type CreateCategoryBody,
  type UpdateCategoryBody,
} from '@/features/categories/types/admin-categories';

import type { Uuid } from '@repo/api-client';

export interface CategoriesScreenProps {
  initialTree?: AdminCategory[];
}

const EMPTY_TREE: AdminCategory[] = [];

export function CategoriesScreen({ initialTree }: CategoriesScreenProps) {
  const t = useTranslations('admin.categories');
  const errorCopy = useCatalogErrorCopy();

  const query = useAdminCategories({ includeArchived: true, initialData: initialTree });

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const reorder = useReorderCategories();
  const archive = useArchiveCategory();
  const remove = useDeleteCategory();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | undefined>(undefined);
  const [defaultParentId, setDefaultParentId] = useState<Uuid | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | undefined>(undefined);
  const [dragId, setDragId] = useState<Uuid | null>(null);

  const queryTree = query.data;
  const tree = useMemo(() => queryTree ?? EMPTY_TREE, [queryTree]);
  const rows = useMemo(() => flattenCategoryTree(tree), [tree]);

  const applyOrder = useCallback(
    async (row: CategoryTreeRow, toIndex: number): Promise<void> => {
      const nextOrder = moveWithin(row.siblingIds, row.indexInSiblings, toIndex);
      if (nextOrder.join() === row.siblingIds.join()) return;

      try {
        await reorder.mutateAsync({
          parentId: row.depth === 0 ? null : row.category.parentId,
          categoryIds: nextOrder,
        });
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [errorCopy, reorder],
  );

  const handleCreate = useCallback(
    async (body: CreateCategoryBody): Promise<void> => {
      try {
        const created = await createCategory.mutateAsync(body);
        setFormOpen(false);
        toast.success(t('toast.created', { name: created.name }));
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [createCategory, errorCopy, t],
  );

  const handleUpdate = useCallback(
    async (categoryId: Uuid, body: UpdateCategoryBody): Promise<void> => {
      try {
        const saved = await updateCategory.mutateAsync({ categoryId, body });
        setFormOpen(false);
        toast.success(t('toast.saved', { name: saved.name }));
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [errorCopy, t, updateCategory],
  );

  const handleArchive = useCallback(
    async (category: AdminCategory): Promise<void> => {
      const action = category.archived ? 'restore' : 'archive';
      try {
        await archive.mutateAsync({ categoryId: category.id, action });
        setDeleting(undefined);
        toast.success(
          action === 'archive'
            ? t('toast.archived', { name: category.name })
            : t('toast.restored', { name: category.name }),
        );
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [archive, errorCopy, t],
  );

  const handleDelete = useCallback(
    async (category: AdminCategory): Promise<void> => {
      try {
        await remove.mutateAsync(category.id);
        setDeleting(undefined);
        toast.success(t('toast.deleted', { name: category.name }));
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [errorCopy, remove, t],
  );

  const openCreate = (parentId: Uuid | null): void => {
    setEditing(undefined);
    setDefaultParentId(parentId);
    setFormOpen(true);
  };

  const openEdit = (category: AdminCategory): void => {
    setEditing(category);
    setDefaultParentId(category.parentId);
    setFormOpen(true);
  };

  const header = (
    <AdminPageHeader
      title={t('title')}
      actions={
        <Button
          size="sm"
          startIcon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => openCreate(null)}
        >
          {t('addCategory')}
        </Button>
      }
    />
  );

  if (query.isPending) {
    return (
      <AdminPage>
        {header}
        <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-2">
          <VisuallyHidden>{t('loading')}</VisuallyHidden>
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-row w-full rounded-sm" animate={false} />
          ))}
        </div>
      </AdminPage>
    );
  }

  if (query.isError) {
    return (
      <AdminPage>
        {header}
        {isSignedOut(query.error) ? (
          <SignedOutState />
        ) : isPermissionDenied(query.error) ? (
          <PermissionDeniedState />
        ) : (
          <ErrorState
            title={t('error.title')}
            description={errorCopy.message(query.error)}
            onRetry={() => void query.refetch()}
            retryLabel={t('error.retry')}
            retrying={query.isFetching}
          />
        )}
      </AdminPage>
    );
  }

  if (rows.length === 0) {
    return (
      <AdminPage>
        {header}
        <EmptyState
          title={t('empty.title')}
          description={t('empty.body')}
          action={
            <Button
              startIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => openCreate(null)}
            >
              {t('empty.action')}
            </Button>
          }
        />
        <CategoryFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          rootCategories={tree}
          defaultParentId={defaultParentId}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          saving={createCategory.isPending || updateCategory.isPending}
        />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      {header}

      <Table caption={t('tableCaption')}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <VisuallyHidden>{t('columns.order')}</VisuallyHidden>
            </TableHead>
            <TableHead className="w-14">
              <VisuallyHidden>{t('columns.cover')}</VisuallyHidden>
            </TableHead>
            <TableHead>{t('columns.name')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('columns.slug')}</TableHead>
            <TableHead numeric className="hidden sm:table-cell">
              {t('columns.published')}
            </TableHead>
            <TableHead>{t('columns.state')}</TableHead>
            <TableHead>
              <VisuallyHidden>{t('columns.actions')}</VisuallyHidden>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const { category, depth } = row;
            const isFirst = row.indexInSiblings === 0;
            const isLast = row.indexInSiblings === row.siblingIds.length - 1;

            return (
              <TableRow
                key={category.id}
                onDragOver={(event) => {
                  if (dragId === null || dragId === category.id) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragId === null) return;
                  const sourceIndex = row.siblingIds.indexOf(dragId);
                  setDragId(null);
                  if (sourceIndex === -1) return;
                  void applyOrder({ ...row, indexInSiblings: sourceIndex }, row.indexInSiblings);
                }}
                className={cn(dragId === category.id && 'opacity-50')}
              >
                <TableCell>
                  <span
                    draggable
                    onDragStart={() => setDragId(category.id)}
                    onDragEnd={() => setDragId(null)}
                    aria-hidden="true"
                    className="inline-flex cursor-grab text-ink-subtle active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" />
                  </span>
                </TableCell>

                <TableCell>
                  <SignedImage
                    src={category.coverImageUrl}
                    alt=""
                    ratio="landscape"
                    rounded="xs"
                    className="w-10"
                    fallbackLabel={t('coverUnavailable')}
                    emptyLabel={t('noCover')}
                  />
                </TableCell>

                <TableCell>
                  <div className={cn('flex flex-col', depth === 1 && 'ps-6')}>
                    <span className="font-medium text-ink">{category.name}</span>
                    {category.nameUr ? (
                      <span lang="ur" dir="rtl" className="text-xs text-ink-muted">
                        {category.nameUr}
                      </span>
                    ) : null}
                    <span className="text-2xs text-ink-subtle md:hidden">{category.slug}</span>
                  </div>
                </TableCell>

                <TableCell className="hidden md:table-cell">
                  <code className="text-xs text-ink-muted">{category.slug}</code>
                </TableCell>

                <TableCell numeric className="hidden sm:table-cell">
                  {category.publishedGarmentCountIncludingChildren}
                </TableCell>

                <TableCell>
                  {category.archived ? (
                    <Badge variant="warning" size="sm">
                      {t('state.archived')}
                    </Badge>
                  ) : (
                    <Badge variant="success" size="sm">
                      {t('state.live')}
                    </Badge>
                  )}
                </TableCell>

                <TableCell>
                  <div className="flex items-center justify-end gap-3">
                    <IconButton
                      size="sm"
                      label={t('actions.moveUp', { name: category.name })}
                      icon={<ChevronUp />}
                      disabled={isFirst || reorder.isPending}
                      onClick={() => void applyOrder(row, row.indexInSiblings - 1)}
                    />
                    <IconButton
                      size="sm"
                      label={t('actions.moveDown', { name: category.name })}
                      icon={<ChevronDown />}
                      disabled={isLast || reorder.isPending}
                      onClick={() => void applyOrder(row, row.indexInSiblings + 1)}
                    />
                    {depth === 0 && (
                      <IconButton
                        size="sm"
                        label={t('actions.addChild', { name: category.name })}
                        icon={<Plus />}
                        onClick={() => openCreate(category.id)}
                      />
                    )}
                    <IconButton
                      size="sm"
                      label={t('actions.edit', { name: category.name })}
                      icon={<Pencil />}
                      onClick={() => openEdit(category)}
                    />
                    <IconButton
                      size="sm"
                      label={
                        category.archived
                          ? t('actions.restore', { name: category.name })
                          : t('actions.archive', { name: category.name })
                      }
                      icon={category.archived ? <ArchiveRestore /> : <ArchiveX />}
                      onClick={() => void handleArchive(category)}
                    />
                    <IconButton
                      size="sm"
                      variant="danger"
                      label={t('actions.delete', { name: category.name })}
                      icon={<Trash2 />}
                      onClick={() => setDeleting(category)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        category={editing}
        rootCategories={tree}
        defaultParentId={defaultParentId}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        saving={createCategory.isPending || updateCategory.isPending}
      />

      {deleting ? (
        <CategoryDeleteDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(undefined);
          }}
          category={deleting}
          busy={remove.isPending || archive.isPending}
          onDelete={() => handleDelete(deleting)}
          onArchive={() => handleArchive(deleting)}
        />
      ) : null}
    </AdminPage>
  );
}
