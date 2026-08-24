import type { Locale, Role, UserStatus } from '@library/common';

export interface AuthUser {
  id: string;
  role: Role;
  email: string;
  emailVerifiedAt: Date | null;
  passwordHash: string;
  name: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  twofaSecret: string | null;
  twofaEnabledAt: Date | null;
  twofaRecoveryCodes: string[] | null;
  status: UserStatus;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  locale: Locale;
  deletionRequestedAt: Date | null;
}

export interface CreateConsumerInput {
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly phone: string | null;
  readonly locale: Locale;
  readonly status?: UserStatus;
}

export type AuthUserPatch = Partial<
  Pick<
    AuthUser,
    | 'passwordHash'
    | 'emailVerifiedAt'
    | 'phone'
    | 'phoneVerifiedAt'
    | 'twofaSecret'
    | 'twofaEnabledAt'
    | 'twofaRecoveryCodes'
    | 'lastLoginAt'
    | 'lastActiveAt'
    | 'failedLoginCount'
    | 'lockedUntil'
  >
>;

export interface UserDirectory {
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  existsByPhone(phone: string): Promise<boolean>;
  createConsumer(input: CreateConsumerInput): Promise<AuthUser>;
  update(userId: string, patch: AuthUserPatch): Promise<void>;
}
