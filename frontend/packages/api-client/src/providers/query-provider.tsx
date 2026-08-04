'use client';

/**
 * The TanStack Query provider — ARCHITECTURE.md §6.4.
 *
 * **SSR safety.** The client is created inside `useState`, so React creates exactly one per
 * component instance. A module-level singleton would be shared across every request on the server,
 * leaking one visitor's cached data into another visitor's render. On the browser the reference is
 * additionally cached in a module variable so a Fast Refresh or a suspended render does not throw
 * the cache away mid-session.
 */

import { type ReactNode, useState } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { isQueryDevtoolsEnabled } from '../config';
import { createQueryClient } from '../query-client';

let browserQueryClient: QueryClient | undefined;

/**
 * One client per request on the server; one client per browser session on the client.
 * Exported so a test or a custom root can reuse the same rule.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    // Server: always a fresh client. Never memoise — the module is shared across requests.
    return createQueryClient();
  }
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

export interface QueryProviderProps {
  children: ReactNode;
  /** Supply a pre-seeded client in tests or Storybook. */
  client?: QueryClient;
  /** Force the devtools on or off; defaults to `NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS` outside production. */
  showDevtools?: boolean;
}

export function QueryProvider({ children, client, showDevtools }: QueryProviderProps) {
  const [queryClient] = useState(() => client ?? getQueryClient());
  const devtoolsVisible = showDevtools ?? isQueryDevtoolsEnabled();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* The devtools button takes physical corners only — it has no logical variant. */}
      {devtoolsVisible ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      ) : null}
    </QueryClientProvider>
  );
}
