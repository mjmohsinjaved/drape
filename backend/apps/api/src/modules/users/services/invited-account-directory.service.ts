import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, type EntityManager } from 'typeorm';

import { ConflictException, ErrorCode, UserStatus } from '@library/common';

import type {
  CreateInvitedAccountInput,
  CreateInvitedAccountOptions,
  InvitedAccountDirectory,
} from '@api/modules/auth/interfaces/invited-account-directory.interface';
import type { AuthUser } from '@api/modules/auth/interfaces/user-directory.interface';

import { User } from '../entities/user.entity';

/**
 * `INVITED_ACCOUNT_DIRECTORY` — the only path in the application, outside the
 * deployment seed, that can write `role = ADMIN` to a `users` row (PRD S-5).
 *
 * It is a separate class from {@link UserDirectoryService} rather than a sixth method
 * on it, so that the object `auth` injects for signup and login has no
 * admin-creating method at runtime, not merely one that is awkward to reach (S-4).
 *
 * The role arrives in `input.role`, and `auth` reads that value off the consumed
 * invite row — never off the request body. This class does not second-guess it: a
 * check here would be a second place where "which accounts may be admins" is
 * decided, and §5.3 puts that decision in the `invites` table.
 */
@Injectable()
export class InvitedAccountDirectoryService implements InvitedAccountDirectory {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async createInvitedAccount(
    input: CreateInvitedAccountInput,
    options: CreateInvitedAccountOptions = {},
  ): Promise<AuthUser> {
    const repository = this.repositoryFor(options.manager);

    // `UQ_users_email` would catch this too, but a 409 with the §2.4 code is a better
    // answer than a driver error, and inside the caller's transaction this read sees
    // any account created earlier in the same unit of work.
    if (await repository.exists({ where: { email: input.email } })) {
      throw new ConflictException(ErrorCode.EMAIL_ALREADY_EXISTS);
    }

    return repository.save(
      repository.create({
        id: input.id,
        role: input.role,
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        emailVerifiedAt: input.emailVerifiedAt,
        locale: input.locale,
        invitedBy: input.invitedBy,
        status: UserStatus.ACTIVE,
        phone: null,
        phoneVerifiedAt: null,
        suspendedReason: null,
        suspendedAt: null,
        lastLoginAt: null,
        lastActiveAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        deletionRequestedAt: null,
      }),
    );
  }

  /** The caller's transaction when it supplied one; this module's own handle otherwise. */
  private repositoryFor(manager?: EntityManager): Repository<User> {
    return manager === undefined ? this.users : manager.getRepository(User);
  }
}
