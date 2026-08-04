'use client';

import { RouteError } from '@/components/states';

import type { RouteErrorProps } from '@/lib/route-params';

/** Catches a failure in the group layout itself, so the shell never takes the page down. */
export default function ConsumerGroupError({ error, reset }: RouteErrorProps) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-consumer items-center justify-center px-5 py-16">
      <RouteError error={error} reset={reset} />
    </div>
  );
}
