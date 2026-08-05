// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@repo/api-client';

import { renderWithProviders } from '@/test/harness';

/**
 * The D-5 error state, and the two things about it that were wrong.
 *
 * 1. **C-41.** `RouteError` rendered `error.message`. Next strips a message only for a *server*
 *    throw; a client-side `ApiError` arrives with the API's own English intact, so an Urdu reader
 *    got an English sentence in the middle of an Urdu screen — from the one component every
 *    screen in the app falls back to.
 * 2. **The root boundary could not render itself.** `app/error.tsx` sits above the only
 *    `NextIntlClientProvider`, which `[locale]/layout.tsx` installs. If that layout threw — the
 *    single failure the root boundary exists for — `useTranslations` found no context and threw
 *    again, escalating to the unstyled English-only `global-error.tsx`.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/ur/browse',
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

function apiFailure(): ApiError {
  return new ApiError({
    statusCode: 503,
    errorCode: 'SERVICE_UNAVAILABLE',
    // The API's §8.3 copy: English, and never display copy.
    message: 'The generation service is unavailable. Try again shortly.',
    requestId: 'req_9',
  });
}

describe('C-41 — no screen renders the API’s own English', () => {
  it('resolves the code through errors.codes instead of showing error.message', async () => {
    const { RouteError } = await import('@/components/states/RouteError');
    await renderWithProviders(<RouteError error={apiFailure()} reset={() => undefined} />, {
      locale: 'en',
    });

    expect(screen.getByText('The service is busy right now. Try again in a moment.')).toBeDefined();
    expect(screen.queryByText(/The generation service is unavailable/)).toBeNull();
  });

  it('says it in Urdu when she is reading in Urdu', async () => {
    const { RouteError } = await import('@/components/states/RouteError');
    await renderWithProviders(<RouteError error={apiFailure()} reset={() => undefined} />, {
      locale: 'ur',
    });

    expect(screen.getByText('سروس اِس وقت مصروف ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔')).toBeDefined();
    expect(screen.queryByText(/generation service/)).toBeNull();
  });

  it('still shows the request id, which is the only correlator E-12 leaves', async () => {
    const { RouteError } = await import('@/components/states/RouteError');
    await renderWithProviders(<RouteError error={apiFailure()} reset={() => undefined} />);

    expect(screen.getByText(/req_9/)).toBeDefined();
  });
});

describe('§8.1 — the root boundary renders without an ancestor provider', () => {
  it('renders in Urdu with no NextIntlClientProvider above it', async () => {
    // Deliberately bare: this is the tree that exists when `[locale]/layout.tsx` is what threw.
    const { default: RootError } = await import('@/app/error');
    render(<RootError error={apiFailure()} reset={() => undefined} />);

    expect(screen.getByText('سروس اِس وقت مصروف ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔')).toBeDefined();
  });
});
