import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

import { ThemeProvider } from '@repo/ui';

import { timeZone, type Locale } from '@/i18n/config';
import { loadClientMessages, type ClientNamespaceGroup } from '@/i18n/messages';

import type { ReactElement, ReactNode } from 'react';

/**
 * The renderer for the behaviour tests.
 *
 * It boots the two contexts every consumer island genuinely needs — the real message catalogue
 * for the route group under test, and a query client — and nothing else. The messages are the
 * ones on disk rather than a stub, so a test that renders a screen also proves the keys it reads
 * resolve for the locale it was rendered in.
 *
 * Retries are off: a test asserting the D-5 error state should not wait out three backoffs.
 */
export async function renderWithProviders(
  ui: ReactElement,
  options: { locale?: Locale; group?: ClientNamespaceGroup } = {},
): Promise<RenderResult> {
  const locale = options.locale ?? 'en';
  const messages = await loadClientMessages(locale, options.group ?? 'consumer');

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  // `ThemeProvider` is here because `AppProviders` has it at the app root, and it is a genuine
  // dependency rather than decoration: it owns the `dark` class on `<html>`, so any island that
  // reads or sets the theme cannot render without it. Leaving it out meant a component using
  // `useTheme()` was untestable through this harness — which is why the theme control had no
  // test while it was writing to a store nobody read.
  const wrap = (node: ReactNode): ReactElement => (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );

  const result = render(wrap(ui));

  // A screen that re-renders from a changed URL is the case several of these tests are about, so
  // `rerender` has to keep the providers rather than drop the element back to a bare tree.
  return { ...result, rerender: (node: ReactNode) => { result.rerender(wrap(node)); } };
}

/** The subset of `AppRouterInstance` the app calls, plus the tape of what it was asked to do. */
export interface RouterSpy {
  /** Hand this to a `vi.mock('next/navigation')` factory as the `useRouter()` return value. */
  router: {
    push: (href: string) => void;
    replace: (href: string) => void;
    refresh: () => void;
    back: () => void;
    forward: () => void;
    prefetch: (href: string) => void;
  };
  /** Every href passed to `push`, in order. */
  pushed: string[];
  /** Every href passed to `replace`, in order. */
  replaced: string[];
  refreshCount: () => number;
}

/**
 * A stand-in for `useRouter()` that records hrefs instead of navigating.
 *
 * The produced URL is the assertion that matters: `/en/renders/x` is the try-on reveal and
 * `/en/en/renders/x` is the root not-found page, and the two are one composition apart.
 */
export function createRouterSpy(): RouterSpy {
  const pushed: string[] = [];
  const replaced: string[] = [];
  let refreshes = 0;

  return {
    router: {
      push: (href) => {
        pushed.push(href);
      },
      replace: (href) => {
        replaced.push(href);
      },
      refresh: () => {
        refreshes += 1;
      },
      back: () => undefined,
      forward: () => undefined,
      prefetch: () => undefined,
    },
    pushed,
    replaced,
    refreshCount: () => refreshes,
  };
}
