'use client';

import { RouteError } from '@/components/states';

import type { RouteErrorProps } from '@/lib/route-params';

/** D-5 error state: what happened, what to do next, and the retry (D-7). */
export default function AuthInviteTokenError({ error, reset }: RouteErrorProps) {
  return <RouteError error={error} reset={reset} />;
}
