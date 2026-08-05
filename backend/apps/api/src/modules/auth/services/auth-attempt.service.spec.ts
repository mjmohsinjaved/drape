import { AppException, ErrorCode, sha256EmailHex } from '@library/common';

import { hash64, uuid } from '../../../../test/factories';
import {
  createServiceUnderTest,
  type TestHarness,
  type InMemoryRepository,
} from '../../../../test/fixtures';
import { FIXED_NOW, freezeClock } from '../../../../test/setup/time';
import { AuthAttempt } from '../entities/auth-attempt.entity';
import { AuthOutcome } from '../enums/auth-outcome.enum';

import {
  AuthAttemptService,
  countConsecutiveFailures,
  lockoutBackoffMinutes,
} from './auth-attempt.service';

const THRESHOLD = 5;
const MAX_MINUTES = 60;
const MINUTE_MS = 60_000;

/**
 * PRD S-6 / ARCHITECTURE §4.7 — "lockout after 5 failures inside 15 minutes,
 * `lockedUntil = now + 2^(n-5)` minutes capped at 60, counted per `emailHash` **and**
 * per `ip` independently."
 *
 * The arithmetic is tested directly rather than through the service, because an
 * off-by-one in a backoff formula is invisible when it is only ever observed as "the
 * request was rejected".
 */
describe('lockoutBackoffMinutes', () => {
  it.each([
    [0, 0],
    [1, 0],
    [4, 0],
  ])('does not lock out after %i failures — below the threshold', (failures, expected) => {
    expect(lockoutBackoffMinutes(failures, THRESHOLD, MAX_MINUTES)).toBe(expected);
  });

  it.each([
    [5, 1],
    [6, 2],
    [7, 4],
    [8, 8],
    [9, 16],
    [10, 32],
  ])(
    'doubles at each failure past the threshold: %i failures → %i minutes',
    (failures, minutes) => {
      expect(lockoutBackoffMinutes(failures, THRESHOLD, MAX_MINUTES)).toBe(minutes);
    },
  );

  it.each([
    [11, 60],
    [12, 60],
    [40, 60],
    [4000, 60],
  ])('caps at the ceiling: %i failures → %i minutes', (failures, minutes) => {
    expect(lockoutBackoffMinutes(failures, THRESHOLD, MAX_MINUTES)).toBe(minutes);
  });

  it('honours a different threshold and ceiling', () => {
    expect(lockoutBackoffMinutes(3, 3, 10)).toBe(1);
    expect(lockoutBackoffMinutes(5, 3, 10)).toBe(4);
    expect(lockoutBackoffMinutes(9, 3, 10)).toBe(10);
  });
});

describe('countConsecutiveFailures', () => {
  const failure = { outcome: AuthOutcome.INVALID_CREDENTIALS };
  const success = { outcome: AuthOutcome.SUCCESS };

  it('counts failures newest-first', () => {
    expect(countConsecutiveFailures([failure, failure, failure])).toBe(3);
  });

  it('stops at a success — signing in ends the run, because rows are never deleted', () => {
    expect(countConsecutiveFailures([failure, failure, success, failure, failure])).toBe(2);
  });

  it('returns zero when the newest attempt succeeded', () => {
    expect(countConsecutiveFailures([success, failure, failure])).toBe(0);
  });

  it('ignores outcomes that are not a credential guess', () => {
    expect(
      countConsecutiveFailures([
        { outcome: AuthOutcome.RATE_LIMITED },
        { outcome: AuthOutcome.SUSPENDED },
        failure,
      ]),
    ).toBe(1);
  });

  it('counts a failed second factor as a failure', () => {
    expect(countConsecutiveFailures([{ outcome: AuthOutcome.TWOFA_FAILED }, failure])).toBe(2);
  });
});

describe('AuthAttemptService', () => {
  const email = 'ayesha@example.invalid';
  const ip = '203.0.113.7';

  let harness: TestHarness;
  let service: AuthAttemptService;
  let attempts: InMemoryRepository<AuthAttempt>;

  beforeEach(async () => {
    freezeClock(FIXED_NOW);
    const created = await createServiceUnderTest(AuthAttemptService, {
      repositories: [AuthAttempt],
    });
    service = created.service;
    harness = created.harness;
    attempts = harness.repository<AuthAttempt>(AuthAttempt);
  });

  afterEach(async () => {
    await harness.close();
  });

  /** A row `minutesAgo` in the past. `createdAt` is explicit: the fixture has no ORM. */
  function seedAttempt(overrides: Partial<AuthAttempt> & { minutesAgo: number }): void {
    const { minutesAgo, ...rest } = overrides;
    attempts.$rows.push({
      id: uuid(),
      createdAt: new Date(FIXED_NOW.getTime() - minutesAgo * MINUTE_MS),
      emailHash: sha256EmailHex(email),
      userId: null,
      ip,
      userAgent: null,
      outcome: AuthOutcome.INVALID_CREDENTIALS,
      route: 'LOGIN',
      user: null,
      ...rest,
    } as AuthAttempt);
  }

  it('stores the sha256 of the address, never the address itself (E-12)', async () => {
    await service.record({
      email,
      userId: null,
      ip,
      userAgent: 'jest',
      outcome: AuthOutcome.INVALID_CREDENTIALS,
      route: 'LOGIN',
    });

    const [row] = attempts.$rows;
    expect(row.emailHash).toBe(sha256EmailHex(email));
    expect(JSON.stringify(row)).not.toContain(email);
  });

  it('hashes the address case-insensitively, so casing cannot dodge the counter', async () => {
    await service.record({
      email: 'AYESHA@Example.Invalid',
      userId: null,
      ip,
      userAgent: null,
      outcome: AuthOutcome.INVALID_CREDENTIALS,
      route: 'LOGIN',
    });

    expect(attempts.$rows[0].emailHash).toBe(sha256EmailHex(email));
  });

  it('does not lock out below the threshold', async () => {
    for (let index = 0; index < THRESHOLD - 1; index += 1) {
      seedAttempt({ minutesAgo: index });
    }

    const state = await service.getLockoutState(email, ip, FIXED_NOW, THRESHOLD, MAX_MINUTES);

    expect(state.locked).toBe(false);
    expect(state.failureCount).toBe(THRESHOLD - 1);
    await expect(
      service.assertNotLockedOut(email, ip, FIXED_NOW, THRESHOLD, MAX_MINUTES),
    ).resolves.toBeUndefined();
  });

  it('locks out at the threshold and reports the wait in seconds', async () => {
    for (let index = 0; index < THRESHOLD; index += 1) {
      seedAttempt({ minutesAgo: index });
    }

    const state = await service.getLockoutState(email, ip, FIXED_NOW, THRESHOLD, MAX_MINUTES);

    expect(state.locked).toBe(true);
    // Newest failure was at FIXED_NOW; the fifth failure costs one minute.
    expect(state.retryAfterSeconds).toBe(60);
  });

  it('throws ACCOUNT_LOCKED carrying details.retryAfterSeconds', async () => {
    for (let index = 0; index < THRESHOLD; index += 1) {
      seedAttempt({ minutesAgo: 0 });
    }

    expect.assertions(3);
    try {
      await service.assertNotLockedOut(email, ip, FIXED_NOW, THRESHOLD, MAX_MINUTES);
    } catch (error) {
      const exception = error as AppException;
      expect(exception).toBeInstanceOf(AppException);
      expect(exception.errorCode).toBe(ErrorCode.ACCOUNT_LOCKED);
      expect(exception.details?.retryAfterSeconds).toBe(60);
    }
  });

  it('ignores failures older than the fifteen-minute window', async () => {
    for (let index = 0; index < THRESHOLD; index += 1) {
      seedAttempt({ minutesAgo: 16 + index });
    }

    const state = await service.getLockoutState(email, ip, FIXED_NOW, THRESHOLD, MAX_MINUTES);

    expect(state.locked).toBe(false);
    expect(state.failureCount).toBe(0);
  });

  it('lets the lock lapse once the backoff has elapsed', async () => {
    // Five failures, the newest two minutes ago: the backoff is one minute.
    for (let index = 0; index < THRESHOLD; index += 1) {
      seedAttempt({ minutesAgo: 2 + index });
    }

    const state = await service.getLockoutState(email, ip, FIXED_NOW, THRESHOLD, MAX_MINUTES);

    expect(state.locked).toBe(false);
    expect(state.retryAfterSeconds).toBe(0);
  });

  it('counts by IP independently of the address (S-6)', async () => {
    // One address per attempt, all from the same IP: password spraying.
    for (let index = 0; index < THRESHOLD; index += 1) {
      seedAttempt({ minutesAgo: index, emailHash: hash64(`victim-${index}`) });
    }

    const untouchedAddress = await service.getLockoutState(
      'someone-else@example.invalid',
      ip,
      FIXED_NOW,
      THRESHOLD,
      MAX_MINUTES,
    );

    expect(untouchedAddress.locked).toBe(true);
  });

  it('counts by address independently of the IP (S-6)', async () => {
    // One IP per attempt, all against the same address: a rotating attacker.
    for (let index = 0; index < THRESHOLD; index += 1) {
      seedAttempt({ minutesAgo: index, ip: `198.51.100.${index}` });
    }

    const freshAddress = await service.getLockoutState(
      email,
      '203.0.113.250',
      FIXED_NOW,
      THRESHOLD,
      MAX_MINUTES,
    );

    expect(freshAddress.locked).toBe(true);
  });

  it('takes the harsher of the two counters', async () => {
    seedAttempt({ minutesAgo: 0, ip: '198.51.100.1' });
    for (let index = 0; index < 8; index += 1) {
      seedAttempt({ minutesAgo: index, emailHash: hash64(`victim-${index}`) });
    }

    const state = await service.getLockoutState(email, ip, FIXED_NOW, THRESHOLD, MAX_MINUTES);

    // The IP has eight consecutive failures → 2^(8-5) = 8 minutes.
    expect(state.retryAfterSeconds).toBe(8 * 60);
  });
});
