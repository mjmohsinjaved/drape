// @vitest-environment jsdom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRouterSpy, renderWithProviders } from '@/test/harness';

import type { CatalogFacets } from '@/features/catalog-browse/api/types';
import type { BrowseFilters as Filters } from '@/features/catalog-browse/lib/filters';

/**
 * The C-17 filter island.
 *
 * Two defects, one shape: the search box and the price band held **derived** state seeded once
 * from the URL and never resynced. "Clear all" empties the URL and the chips, and both inputs
 * went on showing the values she had just cleared — with an apply button that would put them
 * back. The URL is the truth here; anything on screen that disagrees with it is a filter she
 * thinks is applied and is not, or the reverse.
 */

const routerSpy = createRouterSpy();
async function openFilterPanel(
  user: ReturnType<typeof userEvent.setup>,
  name = /filters/i,
): Promise<void> {
  const triggers = screen.getAllByRole('button', { name });
  const panelTrigger = triggers[triggers.length - 1];
  if (!panelTrigger) throw new Error('no filter trigger rendered');
  await user.click(panelTrigger);
}

vi.mock('next/navigation', () => ({
  useRouter: () => routerSpy.router,
  usePathname: () => '/en/browse',
  useSearchParams: () => new URLSearchParams(),
}));

const FACETS: CatalogFacets = {
  categories: [],
  colors: [],
  sizes: [],
  embellishmentWeights: [],
  modes: [],
  priceRange: { min: 12_000, max: 185_000, currency: 'PKR' },
} as unknown as CatalogFacets;

function filters(overrides: Partial<Filters> = {}): Filters {
  return { page: 1, sort: 'NEWEST', ...overrides } as Filters;
}

describe('C-17 — the controls follow the URL', () => {
  beforeEach(() => {
    routerSpy.pushed.length = 0;
    routerSpy.replaced.length = 0;
  });

  it('empties the search box when the applied term is cleared from the URL', async () => {
    const { BrowseFilters } = await import(
      '@/features/catalog-browse/components/BrowseFilters'
    );

    const { rerender } = await renderWithProviders(
      <BrowseFilters
        locale="en"
        filters={filters({ search: 'kalidar' })}
        facets={FACETS}
        resultCount={4}
      />,
      { group: 'public' },
    );

    const search = screen.getByRole('searchbox');
    expect((search as HTMLInputElement).value).toBe('kalidar');

    // What "Clear all" does: it pushes a bare pathname, and the server re-renders this island
    // with no `search` in `filters`.
    rerender(
      <BrowseFilters locale="en" filters={filters()} facets={FACETS} resultCount={40} />,
    );

    expect(
      (screen.getByRole('searchbox') as HTMLInputElement).value,
      'the box still offers a term the URL no longer carries',
    ).toBe('');
  });

  it('empties the price band when the applied band is cleared from the URL', async () => {
    const user = userEvent.setup();
    const { BrowseFilters } = await import(
      '@/features/catalog-browse/components/BrowseFilters'
    );

    const { rerender } = await renderWithProviders(
      <BrowseFilters
        locale="en"
        filters={filters({ priceMin: 20_000, priceMax: 90_000 })}
        facets={FACETS}
        resultCount={4}
      />,
      { group: 'public' },
    );

    await openFilterPanel(user);

    const lowest = screen.getByLabelText('Lowest price') as HTMLInputElement;
    const highest = screen.getByLabelText('Highest price') as HTMLInputElement;
    expect([lowest.value, highest.value]).toEqual(['20000', '90000']);

    rerender(
      <BrowseFilters locale="en" filters={filters()} facets={FACETS} resultCount={40} />,
    );

    expect([
      (screen.getByLabelText('Lowest price') as HTMLInputElement).value,
      (screen.getByLabelText('Highest price') as HTMLInputElement).value,
    ]).toEqual(['', '']);
  });

  it('does not re-apply a cleared term when the apply control is used again', async () => {
    const user = userEvent.setup();
    const { BrowseFilters } = await import(
      '@/features/catalog-browse/components/BrowseFilters'
    );

    const { rerender } = await renderWithProviders(
      <BrowseFilters
        locale="en"
        filters={filters({ search: 'kalidar' })}
        facets={FACETS}
        resultCount={4}
      />,
      { group: 'public' },
    );

    rerender(
      <BrowseFilters locale="en" filters={filters()} facets={FACETS} resultCount={40} />,
    );
    routerSpy.pushed.length = 0;

    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(routerSpy.pushed.join('|')).not.toContain('kalidar');
  });

  it('isolates each price so an Urdu reader is not shown the maximum first', async () => {
    const user = userEvent.setup();
    const { BrowseFilters } = await import(
      '@/features/catalog-browse/components/BrowseFilters'
    );

    await renderWithProviders(
      <BrowseFilters locale="ur" filters={filters()} facets={FACETS} resultCount={40} />,
      { locale: 'ur', group: 'public' },
    );

    await openFilterPanel(user, /چھانٹیں/);

    // `<bdi>` is what keeps a left-to-right amount left-to-right inside right-to-left prose.
    // Concatenated in source order without it, the bidi algorithm swaps the two amounts.
    // The panel renders in a portal, so the query runs over the document, not the container.
    const isolated = [...document.querySelectorAll('bdi')].map((node) => node.textContent);
    expect(isolated.length).toBe(2);
    expect(isolated[0]).toContain('12,000');
    expect(isolated[1]).toContain('185,000');
  });
});
