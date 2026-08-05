import type { Locale, Role, UserStatus } from '@library/common';

/**
 * The seam between `auth` and `users`.
 *
 * §4.33 gives `users` to the `users` module and §2.9 rule 5 forbids a module from
 * reaching into another module's repository, so auth declares the narrow surface it
 * needs and the `users` module binds an implementation to `USER_DIRECTORY`.
 *
 * The shape is deliberately a **subset of the `users` row** (§4.3), not a
 * re-modelling of it: the entity satisfies this interface structurally, so the
 * implementation is a thin repository wrapper and nothing has to be mapped twice.
 */
export interface AuthUser {
  id: string;
  /** Authoritative on every request (S-3). The `sessions.role` snapshot is only a hint. */
  role: Role;
  email: string;
  emailVerifiedAt: Date | null;
  /** Argon2id (S-6). Never logged, never returned by any endpoint. */
  passwordHash: string;
  name: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  /** AES-256-GCM ciphertext under `TWOFA_ENCRYPTION_KEY`, never plaintext. */
  twofaSecret: string | null;
  twofaEnabledAt: Date | null;
  /** Hashed recovery codes. The plaintext is shown once and never stored. */
  twofaRecoveryCodes: string[] | null;
  status: UserStatus;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  locale: Locale;
  deletionRequestedAt: Date | null;
}

/**
 * Everything `/auth/signup` may set.
 *
 * **There is no `role` field, by construction** (S-4). The only account this seam
 * can create is a consumer; there is no argument an attacker — or a careless
 * refactor — could pass to make it produce an admin.
 */
export interface CreateConsumerInput {
  /** Already lower-cased and trimmed by the caller (§4.3). */
  readonly email: string;
  readonly name: string;
  /** Argon2id hash. The plaintext never crosses this boundary. */
  readonly passwordHash: string;
  readonly phone: string | null;
  readonly locale: Locale;
}

/** The `users` columns auth is allowed to write. Role and status are not among them. */
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

/**
 * Implemented by the `users` module, consumed by `auth`.
 *
 * Every lookup returns `null` rather than throwing, because the S-6 generic-response
 * rule makes "no such account" indistinguishable from "wrong password" at the call
 * site — an exception here would create exactly the enumeration oracle the rule
 * exists to close.
 */
export interface UserDirectory {
  /** Case-insensitive lookup on the lower-cased address (`UQ_users_email`). */
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  /** True when the E.164 number already belongs to a live account (`PHONE_ALREADY_EXISTS`). */
  existsByPhone(phone: string): Promise<boolean>;
  /** Creates a CONSUMER. There is no code path here that can produce an admin (S-4). */
  createConsumer(input: CreateConsumerInput): Promise<AuthUser>;
  /** Applies an auth-owned column patch. Never touches `role` or `status`. */
  update(userId: string, patch: AuthUserPatch): Promise<void>;
}
