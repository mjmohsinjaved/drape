'use client';

import * as React from 'react';

/**
 * `React.useId()` with an optional caller override.
 *
 * Form atoms wire `aria-describedby` / `aria-labelledby` from generated ids, but a caller that
 * already owns an id (a server-rendered label, a test) must be able to hand one in without the
 * component silently generating a second one.
 */
export function useIdOr(provided?: string): string {
  const generated = React.useId();
  return provided ?? generated;
}
