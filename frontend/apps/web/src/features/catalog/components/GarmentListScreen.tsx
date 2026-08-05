'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSearchParams } from 'next/navigation';

import { Plus, Search, Stethoscope } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  Kbd,
  Pagination,
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

import { AdminPage, AdminPageHeader } from '@/features/catalog/components/AdminPage';
import { BulkActionBar, type BulkOperation } from '@/features/catalog/components/BulkActionBar';
import { BulkRunDialog } from '@/features/catalog/components/BulkRunDialog';
import {
  PublishStatePill,
  QualityPill,
  TestRenderStatePill,
} from '@/features/catalog/components/CatalogPills';
import { FirstRunGuide } from '@/features/catalog/components/FirstRunGuide';
import {
  isPermissionDenied,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import { useGarmentList, useGarmentStateChange } from '@/features/catalog/hooks/use-garments';
import {
  CATALOG_PAGE_SIZE,
  isUnfiltered,
  parseListState,
  serialiseListState,
  toApiQuery,
  type CatalogListState,
} from '@/features/catalog/schemas/list-query';
import {
  DEFAULT_QUALITY_MIN_SCORE,
  GARMENT_SORT_PRESETS,
  MAX_BULK_GARMENTS,
  MAX_BULK_TEST_RENDERS,
  type AdminGarment,
} from '@/features/catalog/types/admin-catalog';
import {
  collectCategories,
  type AdminCategory,
} from '@/features/categories/types/admin-categories';
import { Link, useRouter } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { Paginated, PublishState, Uuid } from '@repo/api-client';

export interface GarmentListScreenProps {
  locale: Locale;
  initialPage?: Paginated<AdminGarment>;
  /** The tree, for the category filter and the bulk re-categorise picker. */
  categories: AdminCategory[];
}

const ANY_OPTION = '__any__';

/** A stable empty page, so "no data yet" is not a new array identity on every render. */
const EMPTY_ROWS: AdminGarment[] = [];

/**
 * A-14 — the catalog list.
 *
 * Dense and tabular, with server-driven pagination and the filter state in the URL so a filtered
 * view is linkable and survives a reload.
 *
 * **D-19, keyboard shortcuts for repetitive work.** The table owns a cursor rather than relying
 * on tab order: `j`/`k` (or the arrows) move it, `Enter` opens, `x` selects, `p` publishes, `a`
 * goes to the test-render approval, `/` returns to the search box. Shortcuts are bound to the
 * table body, not to the document, so nothing is stolen from a field the admin is typing in —
 * except `/`, which is the one shortcut that has to work from anywhere on the screen and is
 * therefore ignored whenever a control already has focus.
 */
export function GarmentListScreen({ locale, initialPage, categories }: GarmentListScreenProps) {
  const t = useTranslations('admin.catalog');
  const errorCopy = useCatalogErrorCopy();
  const router = useRouter();
  const searchParams = useSearchParams();

  const state = useMemo(() => parseListState(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(state.search);
  const searchRef = useRef<HTMLInputElement>(null);

  const query = useGarmentList(toApiQuery(state), state.page === 1 ? initialPage : undefined);
  const stateChange = useGarmentStateChange();

  const [selectedIds, setSelectedIds] = useState<Uuid[]>([]);
  const [cursor, setCursor] = useState(0);
  const [bulkOperation, setBulkOperation] = useState<BulkOperation | null>(null);

  // `?? []` inside the memo rather than beside it: a fresh literal on every render would make
  // every memo that reads it recompute, which is what they exist to avoid.
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
      // Any filter change resets to the first page — page 4 of a different result set is nowhere.
      push({ ...state, ...patch, page: patch.page ?? 1 });
    },
    [push, state],
  );

  // Keep the cursor inside the page after a filter change or a page turn.
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
        // The gates live server-side; the refusal explains which one and where to fix it (A-11).
        toast.error(errorCopy.fromError(error), {
          description: t('toast.publishBlockedHint'),
        });
      }
    },
    [errorCopy, stateChange, t],
  );

  const handleTableKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>): void => {
    if (rows.length === 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

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
      case 'a':
        if (garment) {
          event.preventDefault();
          router.push(routes.admin.garmentTestRender(locale, garment.id));
        }
        break;
      default:
        break;
    }
  };

  // `/` focuses search from anywhere on this screen, unless a control already has focus.
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
      description={t('description')}
      actions={
        <>
          <Button asChild variant="secondary" size="sm">
            <Link href={routes.admin.catalogHealth(locale)}>
              <Stethoscope aria-hidden="true" className="size-4" />
              {t('healthLink')}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={routes.admin.catalogNew(locale)}>
              <Plus aria-hidden="true" className="size-4" />
              {t('addGarment')}
            </Link>
          </Button>
        </>
      }
      meta={
        meta ? (
          <span>
            {t('resultCount', { total: meta.total, page: meta.page, pages: meta.totalPages })}
          </span>
        ) : null
      }
    />
  );

  const filters = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor="catalog-search" className="text-xs font-medium text-ink-muted">
          {t('filters.searchLabel')}
        </label>
        <form
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
            startAdornment={<Search aria-hidden="true" className="size-4" />}
            type="search"
          />
        </form>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="catalog-category" className="text-xs font-medium text-ink-muted">
          {t('filters.category')}
        </label>
        <Select
          value={state.categoryId ?? ANY_OPTION}
          onValueChange={(value) => update({ categoryId: value === ANY_OPTION ? null : value })}
        >
          <SelectTrigger id="catalog-category" size="sm" className="min-w-40">
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
          <SelectTrigger id="catalog-state" size="sm" className="min-w-36">
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
          <SelectTrigger id="catalog-sort" size="sm" className="min-w-44">
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
    </div>
  );

  /* ---------------------------------------------------------------- D-5 states */

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
        {isPermissionDenied(query.error) ? (
          <PermissionDeniedState />
        ) : (
          <ErrorState
            title={t('error.title')}
            description={errorCopy.fromError(query.error)}
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

      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        <span>{t('shortcuts.intro')}</span>
        <Kbd>j</Kbd>
        <Kbd>k</Kbd>
        <span>{t('shortcuts.move')}</span>
        <Kbd>Enter</Kbd>
        <span>{t('shortcuts.open')}</span>
        <Kbd>x</Kbd>
        <span>{t('shortcuts.select')}</span>
        <Kbd>p</Kbd>
        <span>{t('shortcuts.publish')}</span>
        <Kbd>a</Kbd>
        <span>{t('shortcuts.approve')}</span>
        <Kbd>/</Kbd>
        <span>{t('shortcuts.search')}</span>
      </p>

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
            <TableHead className="hidden sm:table-cell">{t('columns.testRender')}</TableHead>
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
          className="focus-visible:outline-none"
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

              {/*
                §6.2 wants a 40px thumbnail here. `GarmentResponseDto` carries no image URL and
                there is no batch image endpoint, so a thumbnail column would be one extra request
                per row. The SKU carries the identity instead until the list DTO gains a
                `thumbnailUrl` — a column that can never show data is worse than no column.
              */}
              <TableCell>
                <div className="flex flex-col">
                  <Link
                    href={routes.admin.garment(locale, garment.id)}
                    className="font-medium text-ink hover:text-brand"
                  >
                    {garment.title}
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
                {formatCurrency(garment.price, { currency: garment.currency, locale })}
              </TableCell>

              <TableCell>
                <PublishStatePill state={garment.publishState} />
              </TableCell>

              <TableCell className="hidden sm:table-cell">
                <TestRenderStatePill state={garment.testRenderState} />
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
        maxForTestRender={MAX_BULK_TEST_RENDERS}
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
