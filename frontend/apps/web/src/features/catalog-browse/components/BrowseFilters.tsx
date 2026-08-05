'use client';

import { useCallback, useId, useState, useTransition } from 'react';

import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Input,
  Label,
  Spinner,
} from '@repo/ui';

import { CATALOG_SORTS ,type  CatalogFacet,type  CatalogFacets,type  CatalogSort } from '@/features/catalog-browse/api/types';
import {
  activeFilterCount,
  toSearchParams,
  type BrowseFilters as Filters,
} from '@/features/catalog-browse/lib/filters';
import { facetLabel, formatMoney } from '@/features/catalog-browse/lib/format';
import { usePathname, useRouter } from '@/i18n/navigation';

import type { Locale } from '@/i18n/config';

export interface BrowseFiltersProps {
  locale: Locale;
  filters: Filters;
  facets: CatalogFacets | null;
  /** Set on `/browse/[categorySlug]`, where the category is the route rather than a filter. */
  lockedCategoryId?: string;
  resultCount: number;
}

/**
 * The filter island — C-17.
 *
 * **This is the only client component on the browse screen.** It writes the query string and
 * nothing else; the grid around it stays a Server Component and re-renders from the new URL.
 * That is what keeps the first paint server-rendered (§9.1) and makes a filtered view a link
 * someone can send to a friend (§6.5).
 *
 * Every facet arrives with a count, so the UI never offers a filter that would empty the grid
 * (§5.8). A facet the API did not return simply is not drawn.
 *
 * On a phone the controls live in a drawer behind one 44px trigger; from `md` they sit inline.
 * The applied filters are always visible as removable chips, so nothing is ever filtering
 * silently behind a closed drawer.
 */
export function BrowseFilters({
  locale,
  filters,
  facets,
  lockedCategoryId,
  resultCount,
}: BrowseFiltersProps) {
  const t = useTranslations('browse');
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const searchId = useId();

  const appliedCount = activeFilterCount(filters, lockedCategoryId === undefined);

  const navigate = useCallback(
    (next: Partial<Filters>): void => {
      // Any filter change resets to page 1: staying on page 4 of a narrower result set is how
      // a filter silently shows an empty grid.
      const params = toSearchParams({ ...filters, ...next, page: 1 });
      const query = params.toString();
      startTransition(() => {
        router.push(query === '' ? pathname : `${pathname}?${query}`);
      });
    },
    [filters, pathname, router],
  );

  const clearAll = useCallback((): void => {
    setSearchDraft('');
    startTransition(() => {
      router.push(pathname);
    });
    setDrawerOpen(false);
  }, [pathname, router]);

  const submitSearch = useCallback(
    (event: React.FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const trimmed = searchDraft.trim();
      navigate({ search: trimmed === '' ? undefined : trimmed });
    },
    [navigate, searchDraft],
  );

  const controls = (
    <div className="flex flex-col gap-6">
      {lockedCategoryId === undefined ? (
        <FacetGroup
          legend={t('filters.category')}
          anyLabel={t('filters.any')}
          facets={facets?.categories ?? []}
          selected={filters.categoryId}
          onSelect={(value) => {
            navigate({ categoryId: value });
          }}
        />
      ) : null}

      <FacetGroup
        legend={t('filters.color')}
        anyLabel={t('filters.any')}
        facets={facets?.colors ?? []}
        selected={filters.color}
        onSelect={(value) => {
          navigate({ color: value });
        }}
      />

      <FacetGroup
        legend={t('filters.size')}
        anyLabel={t('filters.any')}
        facets={facets?.sizes ?? []}
        selected={filters.size}
        onSelect={(value) => {
          navigate({ size: value });
        }}
      />

      <FacetGroup
        legend={t('filters.weight')}
        anyLabel={t('filters.any')}
        facets={facets?.embellishmentWeights ?? []}
        selected={filters.weight}
        labelFor={(facet) => t(`weights.${facet.value}`)}
        onSelect={(value) => {
          navigate({ weight: value as Filters['weight'] });
        }}
      />

      <FacetGroup
        legend={t('filters.mode')}
        anyLabel={t('filters.any')}
        facets={facets?.modes ?? []}
        selected={filters.mode}
        labelFor={(facet) => t(`modes.${facet.value}`)}
        onSelect={(value) => {
          navigate({ mode: value as Filters['mode'] });
        }}
      />

      {facets?.priceRange ? (
        <PriceBand
          locale={locale}
          min={facets.priceRange.min}
          max={facets.priceRange.max}
          currency={facets.priceRange.currency}
          value={{ from: filters.priceMin, to: filters.priceMax }}
          labels={{
            legend: t('filters.price'),
            from: t('filters.priceMin'),
            to: t('filters.priceMax'),
            apply: t('filters.close'),
          }}
          onApply={(from, to) => {
            navigate({ priceMin: from, priceMax: to });
          }}
        />
      ) : (
        <p className="text-sm text-ink-muted">{t('filters.pricesHidden')}</p>
      )}
    </div>
  );

  return (
    <section aria-label={t('filters.heading')} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <form onSubmit={submitSearch} className="flex min-w-0 flex-1 items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor={searchId}>{t('search.label')}</Label>
            <Input
              id={searchId}
              type="search"
              inputMode="search"
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

        <Button
          type="button"
          variant="secondary"
          className="md:hidden"
          startIcon={<SlidersHorizontal aria-hidden="true" />}
          onClick={() => {
            setDrawerOpen(true);
          }}
        >
          {appliedCount > 0 ? t('filters.openWithCount', { count: appliedCount }) : t('filters.open')}
        </Button>

        <SortSelect
          label={t('sort.label')}
          value={filters.sort}
          optionLabel={(sort) => t(`sort.${sort}`)}
          onChange={(sort) => {
            navigate({ sort });
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <p className="text-sm text-ink-muted">{t('filters.count', { count: resultCount })}</p>
        {isPending ? <Spinner size="sm" label={t('loading.grid')} /> : null}

        {filters.search !== undefined ? (
          <Chip
            label={t('search.resultsFor', { term: filters.search })}
            removeLabel={t('search.clear')}
            onRemove={() => {
              setSearchDraft('');
              navigate({ search: undefined });
            }}
          />
        ) : null}

        {appliedCount > 0 ? (
          <Button type="button" variant="link" size="sm" onClick={clearAll}>
            {t('filters.clearAll')}
          </Button>
        ) : null}
      </div>

      <div className="hidden md:block">{controls}</div>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t('filters.heading')}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>{controls}</DrawerBody>
          <DrawerFooter>
            <Button
              type="button"
              variant="primary"
              fullWidth
              onClick={() => {
                setDrawerOpen(false);
              }}
            >
              {t('filters.close')}
            </Button>
            {appliedCount > 0 ? (
              <Button type="button" variant="ghost" fullWidth onClick={clearAll}>
                {t('filters.clearAll')}
              </Button>
            ) : null}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </section>
  );
}

interface FacetGroupProps {
  legend: string;
  anyLabel: string;
  facets: CatalogFacet[];
  selected: string | undefined;
  labelFor?: (facet: CatalogFacet) => string;
  onSelect: (value: string | undefined) => void;
}

/**
 * One facet row. Rendered as a group of toggle buttons rather than a select, because on a phone
 * a row of 44px chips is one tap and a select is three.
 */
function FacetGroup({ legend, anyLabel, facets, selected, labelFor, onSelect }: FacetGroupProps) {
  if (facets.length === 0) return null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        <FacetChip
          label={anyLabel}
          pressed={selected === undefined}
          onClick={() => {
            onSelect(undefined);
          }}
        />
        {facets.map((facet) => (
          <FacetChip
            key={facet.value}
            label={labelFor ? labelFor(facet) : facetLabel(facet.value, facet.label)}
            count={facet.count}
            pressed={selected === facet.value}
            onClick={() => {
              onSelect(selected === facet.value ? undefined : facet.value);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function FacetChip({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count?: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={[
        'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm',
        'transition-[background-color,color] duration-fast ease-out',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        pressed
          ? 'bg-brand text-brand-fg'
          : 'border border-line-strong bg-surface text-ink hover:bg-surface-sunken',
      ].join(' ')}
    >
      {label}
      {count === undefined ? null : (
        <span className={pressed ? 'text-brand-fg/80' : 'text-ink-subtle'}>{count}</span>
      )}
    </button>
  );
}

function Chip({
  label,
  removeLabel,
  onRemove,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="brand">{label}</Badge>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </span>
  );
}

function SortSelect({
  label,
  value,
  optionLabel,
  onChange,
}: {
  label: string;
  value: CatalogSort;
  optionLabel: (sort: CatalogSort) => string;
  onChange: (sort: CatalogSort) => void;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/*
        A native select rather than the Radix one: it is a plain, four-option preference, and the
        platform picker is faster on a phone and free of any extra JavaScript.
      */}
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value as CatalogSort);
        }}
        className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        {CATALOG_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {optionLabel(sort)}
          </option>
        ))}
      </select>
    </div>
  );
}

function PriceBand({
  locale,
  min,
  max,
  currency,
  value,
  labels,
  onApply,
}: {
  locale: Locale;
  min: number;
  max: number;
  currency: string;
  value: { from: number | undefined; to: number | undefined };
  labels: { legend: string; from: string; to: string; apply: string };
  onApply: (from: number | undefined, to: number | undefined) => void;
}) {
  const fromId = useId();
  const toId = useId();
  const [from, setFrom] = useState(value.from?.toString() ?? '');
  const [to, setTo] = useState(value.to?.toString() ?? '');

  const parse = (raw: string): number | undefined => {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-sm font-medium">{labels.legend}</legend>
      <p className="pb-2 text-sm text-ink-muted">
        {formatMoney(locale, min, currency)} – {formatMoney(locale, max, currency)}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fromId}>{labels.from}</Label>
          <Input
            id={fromId}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={toId}>{labels.to}</Label>
          <Input
            id={toId}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            onApply(parse(from), parse(to));
          }}
        >
          {labels.apply}
        </Button>
      </div>
    </fieldset>
  );
}
