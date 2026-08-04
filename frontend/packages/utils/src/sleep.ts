/**
 * Promise-based delay.
 *
 * Used by the try-on polling fallback and by retry/backoff helpers. Always pass a `signal`
 * where one is available — an un-abortable sleep keeps a timer (and whatever it closes over)
 * alive after the component that started it is gone.
 */

export interface SleepOptions {
  /** Rejects the promise with an `AbortError` when the signal fires. */
  signal?: AbortSignal;
}

/** The rejection thrown when a sleep is aborted. `name` is `'AbortError'`, matching the DOM. */
export class SleepAbortError extends Error {
  constructor(message = 'Sleep aborted.') {
    super(message);
    this.name = 'AbortError';
  }
}

/**
 * @example await sleep(250);
 * @example await sleep(250, { signal: controller.signal });
 */
export function sleep(ms: number, options: SleepOptions = {}): Promise<void> {
  const { signal } = options;
  const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new SleepAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);

    function onAbort(): void {
      clearTimeout(timeoutId);
      reject(new SleepAbortError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
