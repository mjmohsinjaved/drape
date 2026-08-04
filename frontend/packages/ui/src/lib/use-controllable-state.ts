'use client';

import * as React from 'react';

export interface UseControllableStateParams<T> {
  /** Controlled value. When defined, the hook never owns the state. */
  value?: T | undefined;
  /** Initial value for the uncontrolled case. */
  defaultValue: T;
  /** Called on every change, controlled or not. */
  onChange?: ((value: T) => void) | undefined;
}

/**
 * One state hook for the controlled/uncontrolled pattern every form atom needs.
 *
 * Kept local rather than pulled from a Radix internal: the internals are not part of Radix's
 * public API and have changed shape between minors.
 */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: UseControllableStateParams<T>): [T, (next: T | ((prev: T) => T)) => void] {
  const [uncontrolled, setUncontrolled] = React.useState<T>(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : uncontrolled;

  // Reads go through refs so the returned setter keeps a stable identity across renders and
  // can safely be listed in a dependency array.
  const currentRef = React.useRef<T>(current);
  const isControlledRef = React.useRef<boolean>(isControlled);
  const onChangeRef = React.useRef<((value: T) => void) | undefined>(onChange);

  currentRef.current = current;
  isControlledRef.current = isControlled;
  onChangeRef.current = onChange;

  const setValue = React.useCallback((next: T | ((prev: T) => T)) => {
    const resolved =
      typeof next === 'function' ? (next as (prev: T) => T)(currentRef.current) : next;

    if (!isControlledRef.current) {
      setUncontrolled(resolved);
    }
    onChangeRef.current?.(resolved);
  }, []);

  return [current, setValue];
}
