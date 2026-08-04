'use client';

import { RouteError } from '@/components/states';

import type { RouteErrorProps } from '@/lib/route-params';

export default function LocaleError({ error, reset }: RouteErrorProps) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-consumer items-center justify-center px-5 py-16">
      <RouteError error={error} reset={reset} />
    </div>
  );
}
