'use client';

import { RouteError } from '@/components/states';

import type { RouteErrorProps } from '@/lib/route-params';

/**
 * The root error boundary — D-5 error state.
 *
 * It catches anything a locale segment did not, and always offers the retry. It never shows a
 * status code or a stack trace (§8.1).
 */
export default function RootError({ error, reset }: RouteErrorProps) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-consumer items-center justify-center px-5 py-16">
      <RouteError error={error} reset={reset} />
    </div>
  );
}
