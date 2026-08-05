import { computeBackoffMs } from './backoff.util';

const POLICY = { backoffBaseMs: 30_000, backoffMaxMs: 15 * 60_000 };

describe('computeBackoffMs', () => {
  it('doubles from the base, with attempt 1 waiting exactly the base', () => {
    expect(computeBackoffMs(POLICY, 1)).toBe(30_000);
    expect(computeBackoffMs(POLICY, 2)).toBe(60_000);
    expect(computeBackoffMs(POLICY, 3)).toBe(120_000);
  });

  it('caps, however many attempts have failed — the delay cannot grow unbounded', () => {
    expect(computeBackoffMs(POLICY, 10)).toBe(POLICY.backoffMaxMs);
    expect(computeBackoffMs(POLICY, 100)).toBe(POLICY.backoffMaxMs);
    expect(computeBackoffMs(POLICY, 1000)).toBe(POLICY.backoffMaxMs);
  });

  it('treats attempt 0 and negative attempts as the first attempt', () => {
    expect(computeBackoffMs(POLICY, 0)).toBe(30_000);
    expect(computeBackoffMs(POLICY, -5)).toBe(30_000);
  });

  it('waits not at all when the base is non-positive, so tests need no timers', () => {
    expect(computeBackoffMs({ backoffBaseMs: 0, backoffMaxMs: 1000 }, 3)).toBe(0);
    expect(computeBackoffMs({ backoffBaseMs: -1, backoffMaxMs: 1000 }, 3)).toBe(0);
  });

  it('adds jitter as a proportion of the capped delay, never of the uncapped one', () => {
    const jittered = { ...POLICY, jitterRatio: 0.5 };
    expect(computeBackoffMs(jittered, 1, () => 1)).toBe(45_000);
    expect(computeBackoffMs(jittered, 1, () => 0)).toBe(30_000);
    expect(computeBackoffMs(jittered, 99, () => 1)).toBe(POLICY.backoffMaxMs * 1.5);
  });

  it('ignores a negative jitter ratio rather than shortening the delay', () => {
    expect(computeBackoffMs({ ...POLICY, jitterRatio: -1 }, 2, () => 1)).toBe(60_000);
  });
});
