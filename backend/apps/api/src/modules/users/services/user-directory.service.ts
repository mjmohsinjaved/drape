import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Role, UserStatus } from '@library/common';

import type {
  AuthUser,
  AuthUserPatch,
  CreateConsumerInput,
  UserDirectory,
} from '@api/modules/auth/interfaces/user-directory.interface';

import { User } from '../entities/user.entity';

/**
 * `USER_DIRECTORY` — the `users` side of the seam `auth` declares.
 *
 * ### Why the implementation lives here and not in `auth`
 *
 * §4.33 gives the `users` table to this module, and §2.9 rule 5 says "a module never
 * imports another module's entity file. It imports the module." Putting this adapter
 * in `auth` would mean either a second `TypeOrmModule.forFeature([User])` — two
 * modules holding a write handle on one table, with no single place left to enforce
 * what may be written to it — or `auth` importing `users/entities/user.entity.ts`
 * directly. Both are the thing rule 5 exists to prevent. `User` is therefore
 * registered in exactly one `forFeature()` call, this module's, and `auth` reaches
 * the table only through the five methods below.
 *
 * The direction of the module edge follows: `AuthModule` imports `UsersModule`, and
 * `UsersModule` imports nothing from `auth` — it gets `SESSION_REVOCATION` from
 * `AuthModule`'s `@Global()` exports instead. One edge, no cycle, no `forwardRef`.
 *
 * ### The two properties this class is responsible for
 *
 * 1. **It cannot create an admin (S-4).** `createConsumer` hardcodes
 *    `Role.CONSUMER`; there is no parameter that reaches `role`. Account creation
 *    from an invitation is a *different* port with a *different* implementation
 *    (`InvitedAccountDirectoryService`), so the object bound to `USER_DIRECTORY` has
 *    no admin-creating method on it at all — not merely one that is hard to call.
 * 2. **`update` cannot move `role` or `status`.** `AuthUserPatch` is a `Pick` of the
 *    auth-owned columns, and the patch is passed through unchanged, so a role or a
 *    status is not expressible here even by mistake.
 *
 * Lookups return `null` rather than throwing: the S-6 generic-response rule makes "no
 * such account" and "wrong password" indistinguishable at the call site, and an
 * exception would rebuild the enumeration oracle that rule closes.
 *
 * A `User` row satisfies `AuthUser` structurally (§4.3 is a superset of it), so
 * nothing is mapped twice — the entity is returned as the narrower type.
 */
@Injectable()
export class UserDirectoryService implements UserDirectory {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  /**
   * Case-insensitive lookup on the lower-cased address.
   *
   * `UQ_users_email` is `UNIQUE (lower("email")) WHERE "deletedAt" IS NULL` (§4.3),
   * so the column always holds the lower-cased form and the caller has already
   * normalised what it passes. Soft-deleted rows are excluded by TypeORM's
   * `@DeleteDateColumn` handling: a deleted account cannot sign in.
   */
  async findByEmail(email: string): Promise<AuthUser | null> {
    return this.users.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  async findById(id: string): Promise<AuthUser | null> {
    return this.users.findOne({ where: { id } });
  }

  /**
   * `PHONE_ALREADY_EXISTS`.
   *
   * Scoped to live accounts, matching `UQ_users_phone`
   * (`WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL`): a number freed by a
   * deletion is available again, and the unique index agrees.
   */
  async existsByPhone(phone: string): Promise<boolean> {
    return this.users.exists({ where: { phone } });
  }

  /**
   * Creates a **Consumer**. S-4: there is no argument here that can produce an admin.
   *
   * The row starts unverified — `emailVerifiedAt` and `phoneVerifiedAt` are null and
   * only `auth`'s verification endpoints stamp them (C-3) — and `invitedBy` is null,
   * because nobody invited her.
   */
  async createConsumer(input: CreateConsumerInput): Promise<AuthUser> {
    return this.users.save(
      this.users.create({
        // Not `input.role`. There is no such field, by construction (S-4).
        role: Role.CONSUMER,
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        phone: input.phone,
        locale: input.locale,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        twofaSecret: null,
        twofaEnabledAt: null,
        twofaRecoveryCodes: null,
        suspendedReason: null,
        suspendedAt: null,
        invitedBy: null,
        lastLoginAt: null,
        lastActiveAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        deletionRequestedAt: null,
      }),
    );
  }

  /**
   * Applies an auth-owned column patch.
   *
   * An empty patch is a no-op rather than an `UPDATE` with no SET clause, which
   * TypeORM refuses.
   */
  async update(userId: string, patch: AuthUserPatch): Promise<void> {
    if (Object.keys(patch).length === 0) {
      return;
    }
    await this.users.update({ id: userId }, patch);
  }
}
