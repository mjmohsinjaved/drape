'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Pagination,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PermissionDeniedState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  VisuallyHidden,
  toast,
} from '@repo/ui';
import { formatCurrency, formatRelative } from '@repo/utils';

import { LinkPending } from '@/components/navigation/LinkPending';
import { SignedOutState } from '@/components/states';
import { AdminPage, AdminPageHeader } from '@/features/catalog/components/AdminPage';
import { BulkActionBar, type BulkOperation } from '@/features/catalog/components/BulkActionBar';
import { BulkRunDialog } from '@/features/catalog/components/BulkRunDialog';
import { PublishStatePill, QualityPill } from '@/features/catalog/components/CatalogPills';
import { FirstRunGuide } from '@/features/catalog/components/FirstRunGuide';
import {
  isPermissionDenied,
  isSignedOut,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import { useGarmentList, useGarmentStateChange } from '@/features/catalog/hooks/use-garments';
import {
  CATALOG_PAGE_SIZE,
  DEFAULT_LIST_STATE,
  isUnfiltered,
  listStateKey,
  parseListState,
  serialiseListState,
  toApiQuery,
  type CatalogListState,
} from '@/features/catalog/schemas/list-query';
import {
  DEFAULT_QUALITY_MIN_SCORE,
  GARMENT_SORT_PRESETS,
  MAX_BULK_GARMENTS,
  type AdminGarment,
} from '@/features/catalog/types/admin-catalog';
import {
  collectCategories,
  type AdminCategory,
} from '@/features/categories/types/admin-categories';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { Paginated, PublishState, Uuid } from '@repo/api-client';

export interface GarmentListScreenProps {
  locale: Locale;
  initialPage?: Paginated<AdminGarment>;
  initialPageKey?: string;
  categories: AdminCategory[];
}

const ANY_OPTION = '__any__';

const EMPTY_ROWS: AdminGarment[] = [];

export function GarmentListScreen({
  locale,
  initialPage,
  initialPageKey,
  categories,
}: GarmentListScreenProps) {
  const t = useTranslations('admin.catalog');
  const errorCopy = useCatalogErrorCopy();
  const router = useRouter();
  const searchParams = useSearchParams();

  const state = useMemo(() => parseListState(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(state.search);
  const searchRef = useRef<HTMLInputElement>(null);
  const seed =
    initialPageKey !== undefined && initialPageKey === listStateKey(state)
      ? initialPage
      : undefined;

  const query = useGarmentList(toApiQuery(state), seed);
  const stateChange = useGarmentStateChange();

  const [selectedIds, setSelectedIds] = useState<Uuid[]>([]);
  const [cursor, setCursor] = useState(0);
  const [bulkOperation, setBulkOperation] = useState<BulkOperation | null>(null);
  const items = query.data?.items;
  const rows = useMemo(() => items ?? EMPTY_ROWS, [items]);
  const meta = query.data?.meta;
  const flatCategories = useMemo(() => collectCategories(categories), [categories]);

  const push = useCallback(
    (next: CatalogListState): void => {
      const params = serialiseListState(next);
      const suffix = params.toString();
      router.replace(
        suffix === '' ? routes.admin.catalog(locale) : `${routes.admin.catalog(locale)}?${suffix}`,
      );
    },
    [locale, router],
  );

  const update = useCallback(
    (patch: Partial<CatalogListState>): void => {
      push({ ...state, ...patch, page: patch.page ?? 1 });
    },
    [push, state],
  );

  useEffect(() => {
    setCursor(0);
  }, [state.page, state.search, state.categoryId, state.publishState, state.sort]);

  useEffect(() => {
    setSearchDraft(state.search);
  }, [state.search]);

  const selectedGarments = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds],
  );

  const toggleRow = (id: Uuid): void => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  const publishRow = useCallback(
    async (garment: AdminGarment): Promise<void> => {
      const action = garment.publishState === 'PUBLISHED' ? 'unpublish' : 'publish';
      try {
        await stateChange.mutateAsync({ garmentId: garment.id, action });
        toast.success(
          action === 'publish'
            ? t('toast.published', { title: garment.title })
            : t('toast.unpublished', { title: garment.title }),
        );
      } catch (error: unknown) {
        toast.error(errorCopy.message(error), {
          description: t('toast.publishBlockedHint'),
        });
      }
    },
    [errorCopy, stateChange, t],
  );

  const handleTableKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>): void => {
    if (rows.length === 0) return;
    if (event.target !== event.currentTarget) return;

    const garment = rows[cursor];

    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        event.preventDefault();
        setCursor((current) => Math.min(current + 1, rows.length - 1));
        break;
      case 'k':
      case 'ArrowUp':
        event.preventDefault();
        setCursor((current) => Math.max(current - 1, 0));
        break;
      case 'Enter':
        if (garment) {
          event.preventDefault();
          router.push(routes.admin.garment(locale, garment.id));
        }
        break;
      case 'x':
        if (garment) {
          event.preventDefault();
          toggleRow(garment.id);
        }
        break;
      case 'p':
        if (garment) {
          event.preventDefault();
          void publishRow(garment);
        }
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      searchRef.current?.focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const publishedCount = rows.filter((row) => row.publishState === 'PUBLISHED').length;
  const firstDraft = rows.find((row) => row.publishState === 'DRAFT') ?? null;
  const showFirstRun =
    isUnfiltered(state) && state.page === 1 && (meta?.total ?? 0) < 2 && publishedCount === 0;

  const header = (
    <AdminPageHeader
      title={t('title')}
      actions={
        <Button asChild size="sm">
          <Link href={routes.admin.catalogNew(locale)}>
            <Plus aria-hidden="true" className="size-4" />
            {t('addGarment')}
          </Link>
        </Button>
      }
    />
  );

  const appliedFilterCount =
    (state.categoryId === null ? 0 : 1) +
    (state.publishState === null ? 0 : 1) +
    (state.sort === DEFAULT_LIST_STATE.sort ? 0 : 1);

  const filters = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form
        className="w-full min-w-0 sm:w-1/4 sm:min-w-64"
        onSubmit={(event) => {
          event.preventDefault();
          update({ search: searchDraft.trim() });
        }}
      >
        <Input
          id="catalog-search"
          ref={searchRef}
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder={t('filters.searchPlaceholder')}
          aria-label={t('filters.searchLabel')}
          startAdornment={<Search aria-hidden="true" className="size-4" />}
          type="search"
        />
      </form>

      <Popover>
        <span className="relative inline-flex">
          <PopoverTrigger asChild>
            <IconButton
              variant="secondary"
              label={t('filters.open', { count: appliedFilterCount })}
              icon={<SlidersHorizontal aria-hidden="true" />}
            />
          </PopoverTrigger>
          {appliedFilterCount === 0 ? null : (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-1 -end-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-semibold text-brand-fg"
            >
              {appliedFilterCount}
            </span>
          )}
        </span>

        <PopoverContent align="end" className="panel-scroll w-80">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="catalog-category" className="text-xs font-medium text-ink-muted">
                {t('filters.category')}
              </label>
              <Select
                value={state.categoryId ?? ANY_OPTION}
                onValueChange={(value) =>
                  update({ categoryId: value === ANY_OPTION ? null : value })
                }
              >
                <SelectTrigger id="catalog-category" size="sm">
                  <SelectValue placeholder={t('filters.anyCategory')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_OPTION}>{t('filters.anyCategory')}</SelectItem>
                  {flatCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.parentId === null ? category.name : `— ${category.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="catalog-state" className="text-xs font-medium text-ink-muted">
                {t('filters.state')}
              </label>
              <Select
                value={state.publishState ?? ANY_OPTION}
                onValueChange={(value) =>
                  update({ publishState: value === ANY_OPTION ? null : (value as PublishState) })
                }
              >
                <SelectTrigger id="catalog-state" size="sm">
                  <SelectValue placeholder={t('filters.anyState')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_OPTION}>{t('filters.anyState')}</SelectItem>
                  <SelectItem value="DRAFT">{t('publishState.DRAFT')}</SelectItem>
                  <SelectItem value="PUBLISHED">{t('publishState.PUBLISHED')}</SelectItem>
                  <SelectItem value="ARCHIVED">{t('publishState.ARCHIVED')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="catalog-sort" className="text-xs font-medium text-ink-muted">
                {t('filters.sort')}
              </label>
              <Select
                value={state.sort}
                onValueChange={(value) => update({ sort: value as CatalogListState['sort'] })}
              >
                <SelectTrigger id="catalog-sort" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GARMENT_SORT_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {t(`sort.${preset}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {appliedFilterCount === 0 ? null : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  push({
                    ...state,
                    categoryId: null,
                    publishState: null,
                    sort: DEFAULT_LIST_STATE.sort,
                    page: 1,
                  })
                }
              >
                {t('filters.clear')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );

  if (query.isPending) {
    return (
      <AdminPage>
        {header}
        {filters}
        <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-2">
          <VisuallyHidden>{t('loading')}</VisuallyHidden>
          {Array.from({ length: 8 }, (_, index) => (
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
        {}
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
        {filters}
        {isUnfiltered(state) ? (
          <>
            <FirstRunGuide
              locale={locale}
              hasCategory={flatCategories.length > 0}
              draft={null}
              publishedCount={0}
            />
            <EmptyState
              title={t('empty.title')}
              description={t('empty.body')}
              action={
                <Button asChild>
                  <Link href={routes.admin.catalogNew(locale)}>{t('empty.action')}</Link>
                </Button>
              }
            />
          </>
        ) : (
          <EmptyState
            title={t('noMatches.title')}
            description={t('noMatches.body')}
            tone="neutral"
            action={
              <Button
                variant="secondary"
                onClick={() =>
                  push({
                    search: '',
                    categoryId: null,
                    publishState: null,
                    sort: state.sort,
                    page: 1,
                  })
                }
              >
                {t('noMatches.action')}
              </Button>
            }
          />
        )}
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      {header}
      {filters}

      {showFirstRun ? (
        <FirstRunGuide
          locale={locale}
          hasCategory={flatCategories.length > 0}
          draft={firstDraft}
          publishedCount={publishedCount}
        />
      ) : null}

      <Table caption={t('tableCaption')}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : selectedIds.length > 0 ? 'indeterminate' : false}
                onCheckedChange={() => setSelectedIds(allSelected ? [] : rows.map((row) => row.id))}
                aria-label={t('selectAll')}
              />
            </TableHead>
            <TableHead>{t('columns.piece')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('columns.category')}</TableHead>
            <TableHead numeric className="hidden md:table-cell">
              {t('columns.price')}
            </TableHead>
            <TableHead>{t('columns.state')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('columns.quality')}</TableHead>
            <TableHead numeric className="hidden xl:table-cell">
              {t('columns.tryOns')}
            </TableHead>
            <TableHead numeric className="hidden xl:table-cell">
              {t('columns.starRate')}
            </TableHead>
            <TableHead className="hidden xl:table-cell">{t('columns.updated')}</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody
          tabIndex={0}
          onKeyDown={handleTableKeyDown}
          aria-label={t('rowsLabel')}
          className="focus-ring"
        >
          {rows.map((garment, index) => (
            <TableRow
              key={garment.id}
              selected={selectedIds.includes(garment.id)}
              active={index === cursor}
              onClick={() => setCursor(index)}
              className="cursor-default"
            >
              <TableCell>
                <Checkbox
                  checked={selectedIds.includes(garment.id)}
                  onCheckedChange={() => toggleRow(garment.id)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={t('selectRow', { title: garment.title })}
                />
              </TableCell>

              {}
              <TableCell>
                <div className="flex flex-col">
                  {}
                  <Link
                    href={routes.admin.garment(locale, garment.id)}
                    className="pending-dim relative font-medium text-ink hover:text-brand"
                  >
                    {garment.title}
                    <LinkPending size="xs" placement="corner" />
                  </Link>
                  <code className="text-2xs text-ink-subtle">{garment.sku}</code>
                  {garment.flaggedForReview ? (
                    <Badge variant="danger" size="sm" className="mt-1 w-fit">
                      {t('flagged')}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>

              <TableCell className="hidden lg:table-cell">
                {garment.categoryName ?? t('uncategorised')}
              </TableCell>

              <TableCell numeric className="hidden md:table-cell">
                {}
                {formatCurrency(garment.price, {
                  currency: garment.currency,
                  locale,
                  precision: 'exact',
                })}
              </TableCell>

              <TableCell>
                <PublishStatePill state={garment.publishState} />
              </TableCell>

              <TableCell className="hidden lg:table-cell">
                <QualityPill
                  score={garment.qualityScore}
                  minScore={DEFAULT_QUALITY_MIN_SCORE}
                  overridden={garment.qualityOverridden}
                />
              </TableCell>

              <TableCell numeric className="hidden xl:table-cell">
                {garment.tryOnCount}
              </TableCell>

              <TableCell numeric className="hidden xl:table-cell">
                {garment.starRate === null
                  ? t('noStarRate')
                  : `${String(Math.round(garment.starRate * 100))}%`}
              </TableCell>

              <TableCell className="hidden xl:table-cell">
                {formatRelative(garment.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {meta && meta.totalPages > 1 ? (
        <Pagination
          page={meta.page}
          pageCount={meta.totalPages}
          onPageChange={(page) => push({ ...state, page })}
          label={t('paginationLabel')}
          summary={t('paginationSummary', {
            from: (meta.page - 1) * CATALOG_PAGE_SIZE + 1,
            to: Math.min(meta.page * CATALOG_PAGE_SIZE, meta.total),
            total: meta.total,
          })}
        />
      ) : null}

      <BulkActionBar
        selectedCount={selectedIds.length}
        maxForRecords={MAX_BULK_GARMENTS}
        busy={bulkOperation !== null}
        onRun={setBulkOperation}
        onClear={() => setSelectedIds([])}
      />

      {bulkOperation !== null ? (
        <BulkRunDialog
          operation={bulkOperation}
          garments={selectedGarments}
          categories={flatCategories}
          onClose={() => setBulkOperation(null)}
          onFinished={() => {
            setSelectedIds([]);
            void query.refetch();
          }}
        />
      ) : null}
    </AdminPage>
  );
}
