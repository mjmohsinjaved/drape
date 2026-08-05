import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SESSION_RESOLVER } from '@library/common';

import { InvitesModule } from '@api/modules/invites/invites.module';
import { SESSION_REVOCATION } from '@api/modules/users/interfaces/session-revocation.interface';
import { UsersModule } from '@api/modules/users/users.module';

import { AUTH_CONFIG } from './auth.constants';
import { resolveAuthConfig, type AuthConfig } from './config/auth.config';
import { AuthController } from './controllers/auth.controller';
import { InviteAcceptanceController } from './controllers/invite-acceptance.controller';
import { AuthAttempt } from './entities/auth-attempt.entity';
import { Session } from './entities/session.entity';
import { VerificationToken } from './entities/verification-token.entity';
import { SessionCsrfBindingGuard } from './guards/session-csrf-binding.guard';
import { AuthAttemptService } from './services/auth-attempt.service';
import { AuthService } from './services/auth.service';
import { CsrfService } from './services/csrf.service';
import { InviteAcceptanceService } from './services/invite-acceptance.service';
import { PasswordService } from './services/password.service';
import { SessionResolverService } from './services/session-resolver.service';
import { SessionRevocationService } from './services/session-revocation.service';
import { SessionService } from './services/session.service';
import { TotpService } from './services/totp.service';
import { VerificationTokenService } from './services/verification-token.service';

/**
 * `auth` — ARCHITECTURE §5.1, §2.9.
 *
 * Owns `sessions`, `verification_tokens` and `auth_attempts` (§4.33). It does **not**
 * own `users`: that module binds an implementation of `UserDirectory` to
 * `USER_DIRECTORY`, which is the only way auth reads or writes an account
 * (§2.9 rule 5).
 *
 * ### Which way the module edges point
 *
 * This module imports `UsersModule` and `InvitesModule`, and neither imports it back.
 * That is not an accident of ordering, it is the only arrangement that avoids a
 * cycle:
 *
 * - **auth → users** — `USER_DIRECTORY` and `INVITED_ACCOUNT_DIRECTORY` are bound in
 *   `UsersModule`, because `users` owns the table (§4.33) and registering `User` in a
 *   second `forFeature()` here would give two modules a write handle on it.
 * - **auth → invites** — `InviteAcceptanceService` calls `InvitesService.consumeToken`
 *   from inside its own transaction (S-5).
 * - **users → auth is *not* an import.** `users` needs `SESSION_REVOCATION`, which is
 *   bound below; because this module is `@Global()`, that binding is already in
 *   `UsersModule`'s injector. Nothing has to be imported, so `import/no-cycle` stays
 *   satisfied and no `forwardRef()` is needed anywhere.
 *
 * ### The controller mounted on `/invites`
 *
 * `POST /invites/token/:token/accept` is §5.3's path but auth's work — it creates an
 * account. `InviteAcceptanceController` lives here for that reason; see its own doc
 * comment and `invites.controller.ts`, which explains the route's absence from there.
 *
 * ### Why `@Global()`
 *
 * `SessionAuthGuard` is registered as an `APP_GUARD` by `GlobalProvidersModule`, and
 * it injects `SESSION_RESOLVER` — a token only this module can satisfy, because only
 * this module may read a `sessions` row (§2.7 guard 3). The guard is constructed in
 * `GlobalProvidersModule`'s injector, so the binding has to be visible there without
 * that module importing this one. `@Global()` is how Nest expresses exactly that, and
 * it keeps the composition root free of a wiring detail: the orchestrator adds
 * `AuthModule` to `api.module.ts` and nothing else changes. **Until it does, the API
 * cannot boot** — deliberately, per the note in `global-providers.ts`.
 *
 * ### The fifth guard
 *
 * `SessionCsrfBindingGuard` is registered here as an `APP_GUARD`. Providers declared
 * by a feature module are appended *after* those of the modules resolved before it,
 * so it runs after the four fixed guards of §2.7 rather than among them — the stated
 * order is untouched. It exists because guard 1 cannot HMAC-verify a CSRF token
 * against a session that has not been resolved yet; see the guard's own doc comment.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Session, VerificationToken, AuthAttempt]),
    // `users` for the two account ports, `invites` for `consumeToken` (S-5). Both
    // edges point outwards from here; see the note above.
    UsersModule,
    InvitesModule,
  ],
  controllers: [AuthController, InviteAcceptanceController],
  providers: [
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      // `validateEnv` has already refused to start on a malformed environment; this
      // resolves the §7 rows this module needs into one typed object.
      useFactory: (config: ConfigService): AuthConfig => resolveAuthConfig(config),
    },
    PasswordService,
    CsrfService,
    TotpService,
    SessionService,
    VerificationTokenService,
    AuthAttemptService,
    SessionResolverService,
    SessionRevocationService,
    AuthService,
    InviteAcceptanceService,
    {
      // The single most important binding in the application: without it the guard
      // chain has no way to turn a cookie into a caller, and the container refuses
      // to construct `SessionAuthGuard`.
      provide: SESSION_RESOLVER,
      useExisting: SessionResolverService,
    },
    {
      // A-2, A-19. `users` changes `users.status`; only this module may write
      // `sessions.revokedAt`, and the port's `manager` option is what makes the two
      // one transaction. Visible in `UsersModule` through `@Global()`, which is why
      // `users` does not import this module and there is no cycle to break.
      provide: SESSION_REVOCATION,
      useExisting: SessionRevocationService,
    },
    { provide: APP_GUARD, useClass: SessionCsrfBindingGuard },
  ],
  exports: [
    SESSION_RESOLVER,
    SESSION_REVOCATION,
    AUTH_CONFIG,
    // Exported for the modules that legitimately need them: `users` and `invites`
    // revoke sessions on deactivation and suspension (A-2, A-19) and hash a password
    // when an invitation is accepted (S-5). Nothing else in the application should
    // reach for these.
    SessionService,
    PasswordService,
    TotpService,
    AuthService,
  ],
})
export class AuthModule {}
