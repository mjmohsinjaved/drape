import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { debounce } from './debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes once, on the trailing edge, with the last arguments', () => {
    const spy = vi.fn<(term: string) => void>();
    const debounced = debounce(spy, 300);

    debounced('l');
    debounced('le');
    debounced('leh');

    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('leh');
  });

  it('restarts the timer on every call', () => {
    const spy = vi.fn<(term: string) => void>();
    const debounced = debounce(spy, 100);

    debounced('a');
    vi.advanceTimersByTime(90);
    debounced('b');
    vi.advanceTimersByTime(90);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('b');
  });

  it('fires again for a second burst', () => {
    const spy = vi.fn<(term: string) => void>();
    const debounced = debounce(spy, 100);

    debounced('a');
    vi.advanceTimersByTime(100);
    debounced('b');
    vi.advanceTimersByTime(100);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('passes multiple arguments through', () => {
    const spy = vi.fn<(a: number, b: string) => void>();
    const debounced = debounce(spy, 50);

    debounced(1, 'one');
    vi.advanceTimersByTime(50);

    expect(spy).toHaveBeenCalledWith(1, 'one');
  });

  it('cancel drops the pending invocation', () => {
    const spy = vi.fn<(term: string) => void>();
    const debounced = debounce(spy, 100);

    debounced('a');
    expect(debounced.pending()).toBe(true);

    debounced.cancel();
    expect(debounced.pending()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('cancel is a no-op when nothing is pending', () => {
    const spy = vi.fn<() => void>();
    const debounced = debounce(spy, 100);

    expect(() => {
      debounced.cancel();
    }).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('flush invokes immediately and clears the timer', () => {
    const spy = vi.fn<(term: string) => void>();
    const debounced = debounce(spy, 1000);

    debounced('a');
    debounced.flush();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('a');
    expect(debounced.pending()).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', () => {
    const spy = vi.fn<() => void>();
    const debounced = debounce(spy, 100);

    debounced.flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('leading mode fires on the first call and not again for the same burst', () => {
    const spy = vi.fn<(term: string) => void>();
    const debounced = debounce(spy, 100, { leading: true });

    debounced('a');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('a');

    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('leading mode still fires the trailing call when the burst had more than one entry', () => {
    const spy = vi.fn<(term: string) => void>();
    const debounced = debounce(spy, 100, { leading: true });

    debounced('a');
    debounced('b');
    vi.advanceTimersByTime(100);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('b');
  });

  it('trailing: false suppresses the trailing invocation', () => {
    const spy = vi.fn<(term: string) => void>();
    const debounced = debounce(spy, 100, { leading: true, trailing: false });

    debounced('a');
    debounced('b');
    vi.advanceTimersByTime(100);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('a');
  });
});
