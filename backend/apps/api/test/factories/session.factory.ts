import { Role } from '@library/common';

import { Session } from '@api/modules/auth/entities/session.entity';

import { daysFromFixedNow, FIXED_NOW, minutesFromFixedNow } from '../setup/time';

import { buildEntity, hash64, nextSequence, uuid } from './factory.support';

/**
 * `sessions` (§4.5). Custom server-side sessions — no NextAuth, no JWT (§0).
 *
 * `tokenHash` is the sha256 of the opaque 32-byte cookie value; **the raw value is never
 * stored**, so a fixture only ever holds the hash. A test that needs the cookie value should
 * generate it and hash it itself, exactly as the auth service does.
 *
 * Defaults describe a healthy consumer session: 30-day sliding idle expiry, 90-day absolute
 * ceiling, no 2FA pending, not revoked (S-7).
 */
export function buildSession(overrides: Partial<Session> = {}): Session {
  const sequence = nextSequence();

  return buildEntity<Session>(
    Session,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      userId: uuid(),
      tokenHash: hash64(`session-token-${sequence}`),
      csrfSecret: hash64(`csrf-secret-${sequence}`),
      // A snapshot for fast reads. `users.role` stays authoritative and is re-read on every
      // request — never assert authorisation against this column alone (S-3).
      role: Role.CONSUMER,

      ip: '127.0.0.1',
      userAgent: 'jest/drape-test',
      lastSeenAt: FIXED_NOW,
      expiresAt: daysFromFixedNow(30),
      absoluteExpiresAt: daysFromFixedNow(90),

      revokedAt: null,
      revokedReason: null,
    },
    overrides,
  );
}

/** An admin session: 12-hour idle expiry, 7-day absolute ceiling (S-7). */
export function buildAdminSession(overrides: Partial<Session> = {}): Session {
  return buildSession({
    role: Role.ADMIN,
    expiresAt: new Date(FIXED_NOW.getTime() + 12 * 60 * 60 * 1000),
    absoluteExpiresAt: daysFromFixedNow(7),
    ...overrides,
  });
}

/** Past its sliding idle expiry — guard 3 rejects with `SESSION_EXPIRED`. */
export function buildExpiredSession(overrides: Partial<Session> = {}): Session {
  return buildSession({ expiresAt: minutesFromFixedNow(-1), ...overrides });
}

/**
 * Revoked. A-2 and A-19 revoke every session for a user on deactivation or suspension, which
 * is what makes revocation immediate rather than eventual.
 */
export function buildRevokedSession(
  revokedReason = 'LOGOUT',
  overrides: Partial<Session> = {},
): Session {
  return buildSession({ revokedAt: FIXED_NOW, revokedReason, ...overrides });
}
