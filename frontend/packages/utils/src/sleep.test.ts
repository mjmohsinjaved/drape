import { describe, expect, it, vi } from 'vitest';

import { SleepAbortError, sleep } from './sleep';

describe('sleep', () => {
  it('resolves after the requested delay', async () => {
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      const promise = sleep(500).then(settled);

      await vi.advanceTimersByTimeAsync(499);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await promise;
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves immediately for zero, negative and non-finite delays', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-100)).resolves.toBeUndefined();
    await expect(sleep(Number.NaN)).resolves.toBeUndefined();
  });

  it('rejects with an AbortError when the signal fires mid-sleep', async () => {
    const controller = new AbortController();
    const promise = sleep(1000, { signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(SleepAbortError);
    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1000, { signal: controller.signal })).rejects.toBeInstanceOf(
      SleepAbortError,
    );
  });

  it('does not reject when the signal aborts after the sleep already resolved', async () => {
    const controller = new AbortController();
    await sleep(1, { signal: controller.signal });

    expect(() => {
      controller.abort();
    }).not.toThrow();
  });
});
