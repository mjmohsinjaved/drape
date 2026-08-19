'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Ban, RotateCcw, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  resolveErrorCode,
  USER_STATUSES,
  type AdminConsumerListItem,
  type Paginated,
  type UserStatus,
} from '@repo/api-client';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
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
import { formatDate, formatRelative } from '@repo/utils';

import { LinkPending } from '@/components/navigation/LinkPending';
import { SignedOutState } from '@/components/states';
import { AdminPage, AdminPageHeader } from '@/features/catalog/components/AdminPage';
import {
  isPermissionDenied,
  isSignedOut,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import { SuspendConsumerDialog } from '@/features/consumers/components/SuspendConsumerDialog';
import {
  useConsumerList,
  useSuspendConsumer,
  useUnsuspendConsumer,
} from '@/features/consumers/hooks/use-consumers';
import {
  CONSUMER_PAGE_SIZE,
  CONSUMER_SORT_PRESETS,
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
  /** The list view `initialPage` was fetched for, as {@link listStateKey} spells it. */
  initialPageKey?: string;
}

const ANY_OPTION = '__any__';

/** A stable empty page, so "no data yet" is not a new array identity on every render. */
const EMPTY_ROWS: AdminConsumerListItem[] = [];

const STATUS_VARIANT: Readonly<Record<UserStatus, 'success' | 'warning' | 'neutral'>> = {
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

  // Seed the query with the server's rows whenever they *are* the rows being asked for — which
  // is every first render of a list URL, page 4 included, not only page 1.
  const seed =
    initialPageKey !== undefined && initialPageKey === listStateKey(state)
      ? initialPage
      : undefined;

  const query = useConsumerList(toApiQuery(state), seed);
  const suspend = useSuspendConsumer();
  const unsuspend = useUnsuspendConsumer();

  const [cursor, setCursor] = useState(0);
  // Which row a hold is being placed on or lifted from. The whole row is kept, not just the id:
  // both dialogs name her, and a list that refetches underneath them must not blank the name.
  const [suspending, setSuspending] = useState<AdminConsumerListItem | null>(null);
  const [unsuspending, setUnsuspending] = useState<AdminConsumerListItem | null>(null);
  const [actionErrorCode, setActionErrorCode] = useState<string | null>(null);

  // `?? []` inside the memo rather than beside it: a fresh literal on every render would make
  // every memo that reads it recompute, which is what they exist to avoid.
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
      // Any filter change resets to the first page — page 4 of a different result set is nowhere.
      push({ ...state, ...patch, page: patch.page ?? 1 });
    },
    [push, state],
  );

  // Keep the cursor inside the page after a filter change or a page turn.
  useEffect(() => {
    setCursor(0);
  }, [state.page, state.search, state.status, state.hasEnquiries, state.sort]);

  useEffect(() => {
    setSearchDraft(state.search);
  }, [state.search]);

  const handleTableKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>): void => {
    if (rows.length === 0) return;
    // The D-19 row shortcuts belong to the table itself, never to a control inside it.
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
      event.stopPropagation();
      searchRef.current?.focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const confirmSuspend = useCallback(
    async (reason: string): Promise<void> => {
      if (suspending === null) return;
      setActionErrorCode(null);
      try {
        await suspend.mutateAsync({ userId: suspending.id, reason });
        toast.success(t('suspend.done', { name: suspending.name }));
        setSuspending(null);
      } catch (error: unknown) {
        setActionErrorCode(resolveErrorCode(error));
      }
    },
    [suspend, suspending, t],
  );

  const confirmUnsuspend = useCallback(async (): Promise<void> => {
    if (unsuspending === null) return;
    try {
      await unsuspend.mutateAsync(unsuspending.id);
      toast.success(t('unsuspend.done', { name: unsuspending.name }));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error));
    } finally {
      setUnsuspending(null);
    }
  }, [errorCopy, t, unsuspend, unsuspending]);

  const header = (
    <AdminPageHeader
      title={t('title')}
      description={t('description')}
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
        <label htmlFor="consumer-search" className="text-xs font-medium text-ink-muted">
          {t('filters.searchLabel')}
        </label>
        <form
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
            startAdornment={<Search aria-hidden="true" className="size-4" />}
            type="search"
          />
        </form>
      </div>

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
          <SelectTrigger id="consumer-status" size="sm" className="min-w-36">
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
          <SelectTrigger id="consumer-sort" size="sm" className="min-w-44">
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
        {/* A session that ended is not an authorisation refusal — it has its own screen. */}
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

      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        <span>{t('shortcuts.intro')}</span>
        <Kbd>j</Kbd>
        <Kbd>k</Kbd>
        <span>{t('shortcuts.move')}</span>
        <Kbd>Enter</Kbd>
        <span>{t('shortcuts.open')}</span>
        <Kbd>/</Kbd>
        <span>{t('shortcuts.search')}</span>
      </p>

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
                  {/* A-16 authorises the contact details. `dir="ltr"` so an address is not
                      reordered under the Urdu locale, and `break-all` so a long one wraps
                      inside its cell rather than widening the table. */}
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

              {/*
                A-19, at the row. The two states are the only two an admin can move between:
                a DEACTIVATED account is either mid-deletion (C-38, A-20) or closed by its
                owner, and neither is something to be reopened from a list — so it gets no
                control rather than a disabled one that implies the action exists.
              */}
              <TableCell>
                {consumer.status === 'ACTIVE' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    startIcon={<Ban aria-hidden="true" />}
                    onClick={() => {
                      setActionErrorCode(null);
                      setSuspending(consumer);
                    }}
                  >
                    {t('actions.suspend')}
                  </Button>
                ) : consumer.status === 'SUSPENDED' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    startIcon={<RotateCcw aria-hidden="true" />}
                    onClick={() => setUnsuspending(consumer)}
                  >
                    {t('actions.unsuspend')}
                  </Button>
                ) : null}
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

      <SuspendConsumerDialog
        open={suspending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSuspending(null);
            setActionErrorCode(null);
          }
        }}
        consumerName={suspending?.name ?? ''}
        onConfirm={confirmSuspend}
        saving={suspend.isPending}
        errorMessage={actionErrorCode === null ? null : errorCopy.fromCode(actionErrorCode)}
      />

      <ConfirmDialog
        open={unsuspending !== null}
        onOpenChange={(open) => {
          if (!open) setUnsuspending(null);
        }}
        title={t('unsuspend.title', { name: unsuspending?.name ?? '' })}
        description={t('unsuspend.body')}
        confirmLabel={t('unsuspend.confirm')}
        cancelLabel={t('unsuspend.cancel')}
        // Lifting a hold restores access; it destroys nothing, so this is the two-button
        // form rather than the type-the-name one D-17 reserves for deletion.
        tone="primary"
        loading={unsuspend.isPending}
        onConfirm={confirmUnsuspend}
      />
    </AdminPage>
  );
}
