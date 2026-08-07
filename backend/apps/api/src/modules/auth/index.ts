/**
 * `auth` — the module's public surface.
 *
 * Other modules import **this barrel**, never a deep path into `services/` or
 * `entities/` (§1.1, §2.9 rule 5). What is exported here is what auth promises to
 * keep working; everything else is an implementation detail.
 *
 * The two things another module is most likely to want:
 *
 * - `USER_DIRECTORY` + `UserDirectory` — the seam the `users` module must bind
 *   before the API can boot.
 * - `SessionService` — how `users` and `moderation` revoke every session on
 *   deactivation and suspension (A-2, A-19).
 */
export { AuthModule } from './auth.module';
export {
  AUTH_CONFIG,
  AUTH_ROUTES,
  INVITED_ACCOUNT_DIRECTORY,
  REVOKE_REASONS,
  USER_DIRECTORY,
  type AuthRoute,
  type RevokeReason,
} from './auth.constants';
export {
  AUTH_EVENTS,
  type AuthAccountEvent,
  type AuthEventBase,
  type AuthEventName,
  type LoggedInEvent,
  type SessionsRevokedEvent,
  type SignedUpEvent,
  type SignupRoleIgnoredEvent,
} from './auth.events';
export { resolveAuthConfig, type AuthConfig, type AuthConfigSource } from './config/auth.config';
export type {
  CreateInvitedAccountInput,
  CreateInvitedAccountOptions,
  InvitedAccountDirectory,
} from './interfaces/invited-account-directory.interface';
export type {
  AuthUser,
  AuthUserPatch,
  CreateConsumerInput,
  UserDirectory,
} from './interfaces/user-directory.interface';
export { AuthService, type RequestFacts } from './services/auth.service';
export { CsrfService } from './services/csrf.service';
export { PasswordService } from './services/password.service';
export { SessionRevocationService } from './services/session-revocation.service';
export {
  SessionService,
  type IssuedSession,
  type RevokeAllOptions,
  type RevokeOptions,
} from './services/session.service';
