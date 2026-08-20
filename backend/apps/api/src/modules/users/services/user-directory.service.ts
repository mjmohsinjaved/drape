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

@Injectable()
export class UserDirectoryService implements UserDirectory {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async findByEmail(email: string): Promise<AuthUser | null> {
    return this.users.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  async findById(id: string): Promise<AuthUser | null> {
    return this.users.findOne({ where: { id } });
  }

  async existsByPhone(phone: string): Promise<boolean> {
    return this.users.exists({ where: { phone } });
  }

  async createConsumer(input: CreateConsumerInput): Promise<AuthUser> {
    return this.users.save(
      this.users.create({
        role: Role.CONSUMER,
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        phone: input.phone,
        locale: input.locale,
        status: input.status ?? UserStatus.ACTIVE,
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

  async update(userId: string, patch: AuthUserPatch): Promise<void> {
    if (Object.keys(patch).length === 0) {
      return;
    }
    await this.users.update({ id: userId }, patch);
  }
}
