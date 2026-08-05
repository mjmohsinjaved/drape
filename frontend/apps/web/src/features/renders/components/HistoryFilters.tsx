'use client';

import { useCallback, useId, useState, useTransition } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Input, Label, Spinner, Switch } from '@repo/ui';

import {
  NO_VERDICT,
  hasHistoryFilter,
  toHistorySearchParams,
  type HistoryFilters as Filters,
  type VerdictFilter,
} from '@/features/renders/lib/filters';

import type { PersonPhoto } from '@/features/photos/api/types';

export interface HistoryFiltersProps {
  filters: Filters;
  categories: string[];
  /** Her saved photos. The grouping control only appears when she has used more than one (C-30). */
  photos: PersonPhoto[];
  resultCount: number;
}

const VERDICT_OPTIONS: readonly VerdictFilter[] = ['LOVE_IT', 'MAYBE', 'NOT_FOR_ME', NO_VERDICT];

/**
 * History filters — C-25, C-30.
 *
 * The only client component on the history screen. Like the browse filters, it writes the query
 * string and lets the server re-render; the list stays a Server Component and the signed image
 * URLs stay fresh.
 *
 * The "group by photo" switch is **conditional on her actually having used more than one photo**
 * — C-30 says "where she has used more than one", and a grouping control over a single group is
 * a control that does nothing.
 */
export function HistoryFilters({
  filters,
  categories,
  photos,
  resultCount,
}: HistoryFiltersProps) {
  const t = useTranslations('renders.list');
  const tVerdict = useTranslations('renders.verdict');
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // The draft is seeded from the URL and has to keep following it: `clear()` empties the query
  // string, and an input still showing the old term is a filter she thinks is still applied.
  // Adjusting state during render re-runs this component before anything paints.
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [appliedSearch, setAppliedSearch] = useState(filters.search);
  if (appliedSearch !== filters.search) {
    setAppliedSearch(filters.search);
    setSearchDraft(filters.search ?? '');
  }

  const searchId = useId();
  const verdictId = useId();
  const categoryId = useId();
  const photoId = useId();
  const groupId = useId();

  const navigate = useCallback(
    (next: Partial<Filters>): void => {
      const query = toHistorySearchParams({ ...filters, ...next, page: 1 }).toString();
      startTransition(() => {
        router.push(query === '' ? pathname : `${pathname}?${query}`);
      });
    },
    [filters, pathname, router],
  );

  const clear = useCallback((): void => {
    setSearchDraft('');
    startTransition(() => {
      router.push(pathname);
    });
  }, [pathname, router]);

  const selectClass =
    'min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]';

  return (
    <section aria-label={t('filters.heading')} className="flex flex-col gap-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = searchDraft.trim();
          navigate({ search: trimmed === '' ? undefined : trimmed });
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={searchId}>{t('search.label')}</Label>
          <Input
            id={searchId}
            type="search"
            value={searchDraft}
            placeholder={t('search.placeholder')}
            onChange={(event) => {
              setSearchDraft(event.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="secondary" startIcon={<Search aria-hidden="true" />}>
          {t('search.submit')}
        </Button>
      </form>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={verdictId}>{t('filters.verdict')}</Label>
          <select
            id={verdictId}
            className={selectClass}
            value={filters.verdict ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              navigate({ verdict: value === '' ? undefined : (value as VerdictFilter) });
            }}
          >
            <option value="">{t('filters.any')}</option>
            {VERDICT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {/*
                  `NO_VERDICT` used to render `filters.any` as well, so the list held two
                  options reading "All" — one meaning "don't filter", the other meaning "only
                  the ones I haven't judged". Indistinguishable by sight or by screen reader.
                */}
                {option === NO_VERDICT ? t('filters.noVerdict') : tVerdict(option)}
              </option>
            ))}
          </select>
        </div>

        {categories.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={categoryId}>{t('filters.category')}</Label>
            <select
              id={categoryId}
              className={selectClass}
              value={filters.category ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                navigate({ category: value === '' ? undefined : value });
              }}
            >
              <option value="">{t('filters.any')}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {photos.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={photoId}>{t('filters.photo')}</Label>
            <select
              id={photoId}
              className={selectClass}
              value={filters.photoId ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                navigate({ photoId: value === '' ? undefined : value });
              }}
            >
              <option value="">{t('filters.any')}</option>
              {photos.map((photo) => (
                <option key={photo.id} value={photo.id}>
                  {photo.label ?? photo.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {photos.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <Switch
                id={groupId}
                checked={filters.groupByPhoto}
                onCheckedChange={(checked) => {
                  navigate({ groupByPhoto: checked });
                }}
              />
              <Label htmlFor={groupId}>{t('filters.groupByPhoto')}</Label>
            </div>
            <p className="text-xs text-ink-subtle">{t('filters.groupByPhotoHint')}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <p className="text-sm text-ink-muted">{t('count', { count: resultCount })}</p>
        {isPending ? <Spinner size="sm" label={t('loading')} /> : null}
        {hasHistoryFilter(filters) || filters.search !== undefined ? (
          <Button type="button" variant="link" size="sm" onClick={clear}>
            {t('filters.clear')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
