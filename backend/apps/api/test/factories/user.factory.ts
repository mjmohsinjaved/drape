import { Locale, Role, UserStatus } from '@library/common';

import { User } from '@api/modules/users/entities/user.entity';

import { FIXED_NOW } from '../setup/time';

import { buildEntity, FAKE_PASSWORD_HASH, nextSequence, uuid } from './factory.support';

/**
 * `users` (§4.3). One table holds both roles — there is no separate admins table, and no
 * code path where signup can produce `role = ADMIN` (S-4).
 *
 * The default is a **consumer**: active, email verified, no 2FA, never locked out. That is
 * the account almost every test is implicitly about, so a test only has to state its
 * departure from it.
 */
export function buildUser(overrides: Partial<User> = {}): User {
  const sequence = nextSequence();

  return buildEntity<User>(
    User,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      role: Role.CONSUMER,
      // §4.3: stored lower-cased and trimmed. `.invalid` is reserved by RFC 2606, so a
      // fixture address can never resolve to a real mailbox.
      email: `consumer${sequence}@example.invalid`,
      emailVerifiedAt: FIXED_NOW,
      passwordHash: FAKE_PASSWORD_HASH,
      name: `Test Consumer ${sequence}`,
      phone: `+92300${`${sequence}`.padStart(7, '0')}`,
      phoneVerifiedAt: FIXED_NOW,

      status: UserStatus.ACTIVE,
      suspendedReason: null,
      suspendedAt: null,
      invitedBy: null,

      lastLoginAt: FIXED_NOW,
      lastActiveAt: FIXED_NOW,
      failedLoginCount: 0,
      lockedUntil: null,
      locale: Locale.EN,
      deletionRequestedAt: null,
    },
    overrides,
  );
}

/** An admin. Admins arrive by invitation (S-5) or from the E-4 seed, never from signup. */
export function buildAdminUser(overrides: Partial<User> = {}): User {
  const sequence = nextSequence();

  return buildUser({
    role: Role.ADMIN,
    email: `admin${sequence}@example.invalid`,
    name: `Test Admin ${sequence}`,
    ...overrides,
  });
}

/** A consumer who has not verified her email — the C-3 / A-28 generation gate. */
export function buildUnverifiedUser(overrides: Partial<User> = {}): User {
  return buildUser({ emailVerifiedAt: null, phoneVerifiedAt: null, ...overrides });
}

/** A suspended consumer. A-19 requires a reason, so the fixture carries one. */
export function buildSuspendedUser(overrides: Partial<User> = {}): User {
  return buildUser({
    status: UserStatus.SUSPENDED,
    suspendedReason: 'Repeated uploads failing moderation.',
    suspendedAt: FIXED_NOW,
    ...overrides,
  });
}
