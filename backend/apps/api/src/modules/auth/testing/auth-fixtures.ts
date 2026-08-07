import { Locale, Role, UserStatus } from '@library/common';

import { envConfigSource, resolveAuthConfig, type AuthConfig } from '../config/auth.config';

import type {
  AuthUser,
  AuthUserPatch,
  CreateConsumerInput,
  UserDirectory,
} from '../interfaces/user-directory.interface';
import type { AuthCookieOptions, CookieWritingResponse } from '../services/csrf.service';

/**
 * Shared arrangement for the auth unit suite.
 *
 * Nothing here opens a connection or reads a file. The configuration comes from
 * `resolveAuthConfig` reading the fake environment `apps/api/test/setup/test-env.ts`
 * installs, so the tests exercise the same code path production does — including the
 * Argon2 cost parameters, which that file deliberately turns down so a suite that
 * hashes a few dozen passwords still finishes in seconds.
 */
export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return { ...resolveAuthConfig(envConfigSource(process.env)), ...overrides };
}

/** A `users` row as auth sees it, without pulling in the entity class. */
export function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    role: Role.CONSUMER,
    email: 'consumer@example.invalid',
    emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    passwordHash: 'replace-me',
    name: 'Test Consumer',
    phone: '+923001234567',
    phoneVerifiedAt: null,
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    lastActiveAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    locale: Locale.EN,
    deletionRequestedAt: null,
    ...overrides,
  };
}

/** The `UserDirectory` seam, backed by an array so a test can inspect the result. */
export interface FakeUserDirectory extends UserDirectory {
  readonly rows: AuthUser[];
  readonly createConsumer: jest.MockedFunction<UserDirectory['createConsumer']>;
  readonly update: jest.MockedFunction<UserDirectory['update']>;
}

/**
 * A working in-memory `users` module.
 *
 * `createConsumer` is the only account-creating method that exists, and it hard-codes
 * `Role.CONSUMER` exactly as the real implementation must — which is what makes the
 * S-4 test meaningful rather than a tautology about a mock.
 */
export function createFakeUserDirectory(seed: readonly AuthUser[] = []): FakeUserDirectory {
  const rows: AuthUser[] = [...seed];
  let sequence = 0;

  // Each double returns a resolved promise rather than being `async`: there is
  // nothing to await in an array lookup, and the methods exist only to satisfy the
  // Promise-returning `UserDirectory` contract.
  const createConsumer = jest.fn((input: CreateConsumerInput): Promise<AuthUser> => {
    sequence += 1;
    const created = buildAuthUser({
      id: `00000000-0000-4000-8000-00000000000${sequence}`,
      // The seam cannot express any other role. Not a test convenience — the real
      // implementation has the same constraint, because `CreateConsumerInput` has no
      // role field (S-4).
      role: Role.CONSUMER,
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      phone: input.phone,
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
      locale: input.locale,
    });
    rows.push(created);
    return Promise.resolve(created);
  });

  const update = jest.fn((userId: string, patch: AuthUserPatch): Promise<void> => {
    const row = rows.find((candidate) => candidate.id === userId);
    if (row !== undefined) {
      Object.assign(row, patch);
    }
    return Promise.resolve();
  });

  return {
    rows,
    createConsumer,
    update,
    findByEmail: jest.fn((email: string): Promise<AuthUser | null> =>
      Promise.resolve(rows.find((row) => row.email === email.trim().toLowerCase()) ?? null),
    ),
    findById: jest.fn((id: string): Promise<AuthUser | null> =>
      Promise.resolve(rows.find((row) => row.id === id) ?? null),
    ),
    existsByPhone: jest.fn((phone: string): Promise<boolean> =>
      Promise.resolve(rows.some((row) => row.phone === phone)),
    ),
  };
}

/** What a cookie write looked like. */
export interface RecordedCookie {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

export interface CookieRecorder extends CookieWritingResponse {
  readonly written: RecordedCookie[];
  readonly cleared: string[];
  /** The most recent write of a named cookie, or `undefined`. */
  last(name: string): RecordedCookie | undefined;
}

/** An Express-response stand-in that records cookie writes instead of sending them. */
export function createCookieRecorder(): CookieRecorder {
  const written: RecordedCookie[] = [];
  const cleared: string[] = [];

  return {
    written,
    cleared,
    cookie(name: string, value: string, options: AuthCookieOptions): void {
      written.push({ name, value, options: { ...options } });
    },
    clearCookie(name: string): void {
      cleared.push(name);
    },
    last(name: string): RecordedCookie | undefined {
      return [...written].reverse().find((entry) => entry.name === name);
    },
  };
}

/** A `NotificationsService` double: only the two methods auth calls exist. */
export function createNotificationsDouble(): {
  sendTemplatedEmail: jest.Mock;
  sendTemplatedSms: jest.Mock;
} {
  const ok = { ok: true, channel: 'EMAIL', provider: 'test', attempts: 1, durationMs: 0 };
  return {
    sendTemplatedEmail: jest.fn().mockResolvedValue(ok),
    sendTemplatedSms: jest.fn().mockResolvedValue({ ...ok, channel: 'SMS' }),
  };
}
