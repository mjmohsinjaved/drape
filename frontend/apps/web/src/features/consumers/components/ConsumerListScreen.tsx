'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { MoreVertical, Search, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  USER_STATUSES,
  type AdminConsumerListItem,
  type Paginated,
  type UserStatus,
} from '@repo/api-client';
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { formatDate, formatRelative } from '@repo/utils';

import { LinkPending } from '@/components/navigation/LinkPending';
import { SignedOutState } from '@/components/states';
import { AdminPage, AdminPageHeader } from '@/features/catalog/components/AdminPage';
import {
  isPermissionDenied,
  isSignedOut,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import {
  useApproveConsumer,
  useConsumerList,
  useSuspendConsumer,
  useUnsuspendConsumer,
} from '@/features/consumers/hooks/use-consumers';
import {
  CONSUMER_PAGE_SIZE,
  CONSUMER_SORT_PRESETS,
  DEFAULT_LIST_STATE,
  isUnfiltered,
  listStateKey,
  parseListState,
  serialiseListState,
  toApiQuery,
  type ConsumerListState,
} from '@/features/consumers/schemas/list-query';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface ConsumerListScreenProps {
  locale: Locale;
  initialPage?: Paginated<AdminConsumerListItem>;
  initialPageKey?: string;
}

const ANY_OPTION = '__any__';

const EMPTY_ROWS: AdminConsumerListItem[] = [];

const STATUS_VARIANT: Readonly<Record<UserStatus, 'success' | 'warning' | 'neutral' | 'info'>> = {
  PENDING_APPROVAL: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DEACTIVATED: 'neutral',
};

export function ConsumerListScreen({
  locale,
  initialPage,
  initialPageKey,
}: ConsumerListScreenProps) {
  const t = useTranslations('admin.consumers');
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

  const query = useConsumerList(toApiQuery(state), seed);
  const approve = useApproveConsumer();
  const suspend = useSuspendConsumer();
  const unsuspend = useUnsuspendConsumer();

  const [cursor, setCursor] = useState(0);
  const items = query.data?.items;
  const rows = useMemo(() => items ?? EMPTY_ROWS, [items]);
  const meta = query.data?.meta;

  const push = useCallback(
    (next: ConsumerListState): void => {
      const params = serialiseListState(next);
      const suffix = params.toString();
      router.replace(
        suffix === ''
          ? routes.admin.consumers(locale)
          : `${routes.admin.consumers(locale)}?${suffix}`,
      );
    },
    [locale, router],
  );

  const update = useCallback(
    (patch: Partial<ConsumerListState>): void => {
      push({ ...state, ...patch, page: patch.page ?? 1 });
    },
    [push, state],
  );

  useEffect(() => {
    setCursor(0);
  }, [state.page, state.search, state.status, state.hasEnquiries, state.sort]);

  useEffect(() => {
    setSearchDraft(state.search);
  }, [state.search]);

  const handleTableKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>): void => {
    if (rows.length === 0) return;
    if (event.target !== event.currentTarget) return;

    const consumer = rows[cursor];

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
        if (consumer) {
          event.preventDefault();
          router.push(routes.admin.consumer(locale, consumer.id));
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

  const activateRow = useCallback(
    async (consumer: AdminConsumerListItem): Promise<void> => {
      try {
        if (consumer.status === 'PENDING_APPROVAL') {
          await approve.mutateAsync(consumer.id);
        } else {
          await unsuspend.mutateAsync(consumer.id);
        }
        toast.success(t('toast.activated', { name: consumer.name }));
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [approve, errorCopy, t, unsuspend],
  );

  const deactivateRow = useCallback(
    async (consumer: AdminConsumerListItem): Promise<void> => {
      try {
        await suspend.mutateAsync({ userId: consumer.id });
        toast.success(t('toast.deactivated', { name: consumer.name }));
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [errorCopy, suspend, t],
  );

  const pendingId =
    (approve.isPending ? approve.variables : undefined) ??
    (unsuspend.isPending ? unsuspend.variables : undefined) ??
    (suspend.isPending ? suspend.variables?.userId : undefined) ??
    null;

  const header = <AdminPageHeader title={t('title')} />;

  const appliedFilterCount =
    (state.status === null ? 0 : 1) +
    (state.hasEnquiries ? 1 : 0) +
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
          id="consumer-search"
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
              <label htmlFor="consumer-status" className="text-xs font-medium text-ink-muted">
                {t('filters.status')}
              </label>
              <Select
                value={state.status ?? ANY_OPTION}
                onValueChange={(value) =>
                  update({ status: value === ANY_OPTION ? null : (value as UserStatus) })
                }
              >
                <SelectTrigger id="consumer-status" size="sm">
                  <SelectValue placeholder={t('filters.anyStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_OPTION}>{t('filters.anyStatus')}</SelectItem>
                  {USER_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`status.${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="consumer-sort" className="text-xs font-medium text-ink-muted">
                {t('filters.sort')}
              </label>
              <Select
                value={state.sort}
                onValueChange={(value) => update({ sort: value as ConsumerListState['sort'] })}
              >
                <SelectTrigger id="consumer-sort" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONSUMER_SORT_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {t(`sort.${preset}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex min-h-9 items-center gap-2 text-xs font-medium text-ink-muted">
              <Checkbox
                checked={state.hasEnquiries}
                onCheckedChange={(checked) => update({ hasEnquiries: checked === true })}
              />
              {t('filters.hasEnquiries')}
            </label>

            {appliedFilterCount === 0 ? null : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  push({
                    ...state,
                    status: null,
                    hasEnquiries: false,
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
          <EmptyState
            title={t('empty.title')}
            description={t('empty.body')}
            action={
              <Button asChild>
                <Link href={routes.admin.catalog(locale)}>{t('empty.action')}</Link>
              </Button>
            }
          />
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
                    status: null,
                    hasEnquiries: false,
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

      <Table caption={t('tableCaption')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.customer')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('columns.phone')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('columns.signedUp')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('columns.lastActive')}</TableHead>
            <TableHead numeric className="hidden xl:table-cell">
              {t('columns.generations')}
            </TableHead>
            <TableHead numeric className="hidden xl:table-cell">
              {t('columns.shortlist')}
            </TableHead>
            <TableHead numeric className="hidden xl:table-cell">
              {t('columns.enquiries')}
            </TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            <TableHead>
              <VisuallyHidden>{t('columns.actions')}</VisuallyHidden>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody
          tabIndex={0}
          onKeyDown={handleTableKeyDown}
          aria-label={t('rowsLabel')}
          className="focus-ring"
        >
          {rows.map((consumer, index) => (
            <TableRow
              key={consumer.id}
              active={index === cursor}
              onClick={() => setCursor(index)}
              className="cursor-default"
            >
              <TableCell>
                <div className="flex flex-col">
                  <Link
                    href={routes.admin.consumer(locale, consumer.id)}
                    className="pending-dim relative font-medium text-ink hover:text-brand"
                  >
                    {consumer.name}
                    <LinkPending size="xs" placement="corner" />
                  </Link>
                  <span dir="ltr" className="text-2xs break-all text-ink-subtle">
                    {consumer.email}
                  </span>
                  <span dir="ltr" className="text-2xs text-ink-subtle md:hidden">
                    {consumer.phone ?? t('noPhone')}
                  </span>
                </div>
              </TableCell>

              <TableCell dir="ltr" className="hidden md:table-cell">
                {consumer.phone ?? <span className="text-ink-subtle">{t('noPhone')}</span>}
              </TableCell>

              <TableCell className="hidden lg:table-cell">
                {formatDate(consumer.signedUpAt)}
              </TableCell>

              <TableCell className="hidden lg:table-cell">
                {consumer.lastActiveAt === null ? (
                  <span className="text-ink-subtle">{t('neverActive')}</span>
                ) : (
                  formatRelative(consumer.lastActiveAt)
                )}
              </TableCell>

              <TableCell numeric className="hidden xl:table-cell">
                {consumer.generationsThisMonth}
              </TableCell>

              <TableCell numeric className="hidden xl:table-cell">
                {consumer.shortlistSize}
              </TableCell>

              <TableCell numeric className="hidden xl:table-cell">
                {consumer.enquiryCount}
              </TableCell>

              <TableCell>
                <Badge variant={STATUS_VARIANT[consumer.status]} size="sm">
                  {t(`status.${consumer.status}`)}
                </Badge>
              </TableCell>

              <TableCell>
                {consumer.status === 'DEACTIVATED' ? null : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label={t('actions.menu', { name: consumer.name })}
                        icon={<MoreVertical aria-hidden="true" />}
                        loading={pendingId === consumer.id}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={consumer.status === 'ACTIVE'}
                        onSelect={() => void activateRow(consumer)}
                      >
                        {t('actions.activate')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        destructive
                        disabled={consumer.status !== 'ACTIVE'}
                        onSelect={() => void deactivateRow(consumer)}
                      >
                        {t('actions.deactivate')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
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
            from: (meta.page - 1) * CONSUMER_PAGE_SIZE + 1,
            to: Math.min(meta.page * CONSUMER_PAGE_SIZE, meta.total),
            total: meta.total,
          })}
        />
      ) : null}
    </AdminPage>
  );
}
