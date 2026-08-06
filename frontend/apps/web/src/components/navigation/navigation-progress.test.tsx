// @vitest-environment jsdom

import { useSyncExternalStore, type ReactNode } from 'react';

import Link from 'next/link';

import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Button,
  NAV_PROGRESS_MIN_VISIBLE_MS,
  NAV_PROGRESS_SHOW_DELAY_MS,
  NavigationPendingProvider,
} from '@repo/ui';

import { NavLink } from '@/components/layout/NavLink';
import { LinkPending } from '@/components/navigation/LinkPending';
import { NavigationProgressBar } from '@/components/navigation/NavigationProgressBar';
import { timeZone } from '@/i18n/config';
import { loadClientMessages } from '@/i18n/messages';

/**
 * The gap between the click and the first byte of the new segment.
 *
 * The app has 55 `loading.tsx` fallbacks, and not one of them helps here: a segment fallback
 * paints when the server starts streaming, so on the mid-range Android over mobile data that
 * §9.1 targets there is a stretch where nothing on screen has changed and the app reads as
 * broken. Everything under test is about that stretch.
 *
 * Four properties, and the second is the one that makes the feature worth shipping rather than
 * merely present: a bar that flashes on every instant navigation is noise, and noise on every
 * tap is worse than the silence it replaced.
 */

/**
 * `useLinkStatus()` reads a context `<Link>` publishes around its own children, and the App
 * Router build of `next/link` is the only one that ever sets it to pending. Under vitest we get
 * the Pages Router build, which is hard-wired to `{ pending: false }` — so the test would assert
 * nothing at all without this.
 *
 * It is a real external store rather than a mutable object, because the component has to
 * *re-render* when the status flips. A getter returning a changed value is invisible to React.
 */
const linkStatus = vi.hoisted(() => {
  let pending = false;
  const listeners = new Set<() => void>();
  return {
    subscribe(onChange: () => void) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    read: () => pending,
    set(next: boolean) {
      pending = next;
      for (const listener of [...listeners]) listener();
    },
    reset() {
      pending = false;
      listeners.clear();
    },
  };
});

vi.mock('next/link', async () => {
  const actual = await vi.importActual<{ default: typeof Link }>('next/link');
  const { useSyncExternalStore: subscribeInMock } = await vi.importActual<{
    useSyncExternalStore: typeof useSyncExternalStore;
  }>('react');

  return {
    ...actual,
    default: actual.default,
    useLinkStatus: () => ({
      pending: subscribeInMock(linkStatus.subscribe, linkStatus.read, () => false),
    }),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/shortlist',
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

/** Reduced motion is read through `matchMedia`; the setup file stubs it as "no preference". */
function stubReducedMotion(reduce: boolean): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

async function mount(ui: ReactNode) {
  const messages = await loadClientMessages('en', 'base');

  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone={timeZone}>
      <NavigationPendingProvider linkPending={LinkPending}>
        <NavigationProgressBar />
        {ui}
      </NavigationPendingProvider>
    </NextIntlClientProvider>,
  );
}

/** The bar is the only `progressbar` in these trees, and it is only mounted while it is up. */
function bar(): HTMLElement | null {
  return screen.queryByRole('progressbar');
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function setPending(pending: boolean): void {
  act(() => {
    linkStatus.set(pending);
  });
}

describe('the navigation progress bar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    linkStatus.reset();
  });

  it('appears while a navigation is pending and goes away when it settles', async () => {
    await mount(<NavLink href="/en/browse">Browse</NavLink>);

    expect(bar()).toBeNull();

    setPending(true);
    // Still nothing: the delay has not elapsed, so an instant navigation would never see it.
    expect(bar()).toBeNull();

    advance(NAV_PROGRESS_SHOW_DELAY_MS);
    expect(bar()).not.toBeNull();

    // The accessible name is the one thing a screen-reader user has to go on.
    expect(bar()?.getAttribute('aria-label')).toBe('Loading the next page');

    setPending(false);
    advance(NAV_PROGRESS_MIN_VISIBLE_MS);
    expect(bar()).toBeNull();
  });

  it('never appears for a navigation that resolves inside the delay window', async () => {
    await mount(<NavLink href="/en/browse">Browse</NavLink>);

    setPending(true);
    advance(NAV_PROGRESS_SHOW_DELAY_MS - 20);
    setPending(false);

    // The point of the delay: a prefetched segment resolves in well under 100 ms, and a bar that
    // painted and vanished inside two frames would read as a glitch on every single tap.
    advance(NAV_PROGRESS_SHOW_DELAY_MS * 4);
    expect(bar()).toBeNull();
  });

  it('holds the bar on screen once shown, so it cannot strobe', async () => {
    await mount(<NavLink href="/en/browse">Browse</NavLink>);

    setPending(true);
    advance(NAV_PROGRESS_SHOW_DELAY_MS);
    expect(bar()).not.toBeNull();

    // Settles one tick after it appeared. Without the floor this would be a 1 ms flash.
    setPending(false);
    advance(1);
    expect(bar()).not.toBeNull();

    advance(NAV_PROGRESS_MIN_VISIBLE_MS);
    expect(bar()).toBeNull();
  });

  it('announces the load politely, and only once it is worth announcing', async () => {
    await mount(<NavLink href="/en/browse">Browse</NavLink>);

    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    setPending(true);
    // Tied to the same delay as the visual: a keystroke-fast navigation says nothing at all.
    advance(NAV_PROGRESS_SHOW_DELAY_MS - 20);
    expect(region.textContent).toBe('');

    advance(20);
    expect(region.textContent).toBe('Loading the next page');
  });

  it('drops the indeterminate animation under prefers-reduced-motion (D-11)', async () => {
    stubReducedMotion(true);
    await mount(<NavLink href="/en/browse">Browse</NavLink>);

    setPending(true);
    advance(NAV_PROGRESS_SHOW_DELAY_MS);

    const fill = bar()?.firstElementChild;
    expect(fill).toBeTruthy();
    // The creep is a keyframe animation on `inline-size`. Under the preference the bar is simply
    // there at full width, and the only motion left is the container's opacity fade.
    expect(fill?.className).not.toContain('nav-progress-fill');
    expect(fill?.className).toContain('w-full');
  });

  it('renders no physical side, so it fills from the reading-start edge in ur (§6.7)', async () => {
    await mount(<NavLink href="/en/browse">Browse</NavLink>);
    setPending(true);
    advance(NAV_PROGRESS_SHOW_DELAY_MS);

    const container = bar()?.parentElement;
    // `inset-x-0` is symmetric and `top-0` is block-direction; neither is a reading-direction
    // decision. A `left-`/`right-` here would pin the bar to one side of one locale.
    expect(container?.className).not.toMatch(/(^|\s)-?(left-|right-|ml-|mr-)/);
    expect(container?.className).toContain('fixed');
  });
});

describe('the per-item pending state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    linkStatus.reset();
  });

  it('shows an indicator on the nav item that was clicked, and clears it', async () => {
    const { container } = await mount(<NavLink href="/en/browse">Browse</NavLink>);

    const link = screen.getByRole('link', { name: 'Browse' });
    expect(container.querySelector('[data-nav-pending]')).toBeNull();

    setPending(true);
    const indicator = link.querySelector('[data-nav-pending]');
    expect(indicator).not.toBeNull();
    // Absolutely positioned, so the label does not move and the rail does not reflow (D-8).
    expect(indicator?.className).toContain('absolute');
    // The bar owns the one live region for navigation; a per-item announcement would repeat it
    // once per link, undelayed (D-20).
    expect(indicator?.getAttribute('aria-hidden')).toBe('true');

    setPending(false);
    expect(link.querySelector('[data-nav-pending]')).toBeNull();
  });

  it('reports to the same counter that raises the bar', async () => {
    await mount(<NavLink href="/en/browse">Browse</NavLink>);

    setPending(true);
    advance(NAV_PROGRESS_SHOW_DELAY_MS);

    // One placement, both signals — so the item and the bar can never disagree about whether a
    // navigation is in flight.
    expect(bar()).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Browse' }).querySelector('[data-nav-pending]')).not.toBeNull();
  });

  it('gives a Button that is really a link the same treatment, with no call-site change', async () => {
    // `<Button asChild><Link/></Button>` is how every navigating call to action in this app is
    // written. None of them can pass `loading`, because only the link's own children can read
    // `useLinkStatus()` — so `Button` slots the indicator in for them.
    await mount(
      <Button asChild variant="primary">
        <Link href="/en/browse">Browse the collection</Link>
      </Button>,
    );

    const cta = screen.getByRole('link', { name: 'Browse the collection' });
    expect(cta.querySelector('[data-nav-pending]')).toBeNull();

    setPending(true);
    expect(cta.querySelector('[data-nav-pending]')).not.toBeNull();
    // The dim is a `:has()` utility on the control, because the element that knows is inside the
    // element that has to react.
    expect(cta.className).toContain('pending-dim');

    setPending(false);
    expect(cta.querySelector('[data-nav-pending]')).toBeNull();
  });
});

describe('useLinkStatus outside a link', () => {
  it('is inert, so the design system works without the app around it', () => {
    // The real `useLinkStatus` returns the context default rather than throwing when there is no
    // `<Link>` above it — which is what lets `Button` slot the indicator onto a `<label>` or an
    // `<a>` without knowing what it is being slotted onto.
    function Probe() {
      const value = useSyncExternalStore(linkStatus.subscribe, linkStatus.read, () => false);
      return <span data-testid="probe">{String(value)}</span>;
    }

    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('false');
  });
});
