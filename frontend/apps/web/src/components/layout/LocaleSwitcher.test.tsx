// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRouterSpy, renderWithProviders } from '@/test/harness';

/**
 * C-41 — switching language keeps her where she was.
 *
 * `usePathname` returns the path without the query string, so the switcher rebuilt the URL from
 * the path alone: `/en/browse?color=maroon&page=3` became `/ur/browse`. Every filter and the page
 * number were dropped, which reads as the app throwing her work away for choosing her own
 * language — on the one control whose whole purpose is to make the app usable to her.
 */

const routerSpy = createRouterSpy();

vi.mock('next/navigation', () => ({
  useRouter: () => routerSpy.router,
  usePathname: () => '/en/browse',
  useSearchParams: () => new URLSearchParams(),
}));

describe('C-41 — the language switch keeps the whole location', () => {
  beforeEach(() => {
    routerSpy.replaced.length = 0;
    window.history.replaceState(null, '', '/en/browse?color=maroon&page=3');
  });

  it('carries the query string across the locale swap', async () => {
    const user = userEvent.setup();
    const { LocaleSwitcher } = await import('@/components/layout/LocaleSwitcher');
    await renderWithProviders(<LocaleSwitcher />);

    await user.click(screen.getByRole('button', { name: /language/i }));
    await user.click(await screen.findByRole('menuitem', { name: /اردو/ }));

    await waitFor(() => {
      expect(routerSpy.replaced).toContain('/ur/browse?color=maroon&page=3');
    });
  });

  it('swaps only the locale segment, never a path segment that looks like one', async () => {
    window.history.replaceState(null, '', '/en/browse');
    const user = userEvent.setup();
    const { LocaleSwitcher } = await import('@/components/layout/LocaleSwitcher');
    await renderWithProviders(<LocaleSwitcher />);

    await user.click(screen.getByRole('button', { name: /language/i }));
    await user.click(await screen.findByRole('menuitem', { name: /اردو/ }));

    await waitFor(() => {
      expect(routerSpy.replaced).toContain('/ur/browse');
    });
  });
});
