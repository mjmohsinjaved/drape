/**
 * Trailing-edge debounce with `cancel` / `flush` / `pending`.
 *
 * Used for catalog search-as-you-type and the admin filter bar. Always `cancel()` in the
 * effect cleanup — a debounced call that fires after unmount is a state update on a dead tree.
 */

export interface DebounceOptions {
  /** Also invoke immediately on the first call of a burst. Defaults to false. */
  leading?: boolean;
  /** Invoke on the trailing edge. Defaults to true. */
  trailing?: boolean;
}

export interface DebouncedFunction<TArgs extends readonly unknown[]> {
  (...args: TArgs): void;
  /** Drops any pending invocation. Safe to call when nothing is pending. */
  cancel(): void;
  /** Invokes a pending call immediately. No-op when nothing is pending. */
  flush(): void;
  /** True while an invocation is scheduled. */
  pending(): boolean;
}

/**
 * @example
 * const debouncedSearch = debounce((term: string) => setQuery(term), 300);
 * useEffect(() => debouncedSearch.cancel, [debouncedSearch]);
 */
export function debounce<TArgs extends readonly unknown[]>(
  fn: (...args: TArgs) => void,
  waitMs: number,
  options: DebounceOptions = {},
): DebouncedFunction<TArgs> {
  const { leading = false, trailing = true } = options;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: TArgs | undefined;

  const invoke = (): void => {
    const args = lastArgs;
    lastArgs = undefined;
    if (args !== undefined) {
      fn(...args);
    }
  };

  const debounced = (...args: TArgs): void => {
    const isLeadingEdge = leading && timeoutId === undefined;

    lastArgs = args;

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    if (isLeadingEdge) {
      lastArgs = undefined;
      fn(...args);
    }

    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      if (trailing) {
        invoke();
      } else {
        lastArgs = undefined;
      }
    }, waitMs);
  };

  debounced.cancel = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    lastArgs = undefined;
  };

  debounced.flush = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
      invoke();
    }
  };

  debounced.pending = (): boolean => timeoutId !== undefined && lastArgs !== undefined;

  return debounced;
}
