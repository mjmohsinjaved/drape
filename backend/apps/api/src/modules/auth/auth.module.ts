import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SESSION_RESOLVER } from '@library/common';

import { InvitesModule } from '@api/modules/invites/invites.module';
import { SettingsModule } from '@api/modules/settings/settings.module';
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

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Session, VerificationToken, AuthAttempt]),
    UsersModule,
    InvitesModule,
    SettingsModule,
  ],
  controllers: [AuthController, InviteAcceptanceController],
  providers: [
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
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
      provide: SESSION_RESOLVER,
      useExisting: SessionResolverService,
    },
    {
      provide: SESSION_REVOCATION,
      useExisting: SessionRevocationService,
    },
    { provide: APP_GUARD, useClass: SessionCsrfBindingGuard },
  ],
  exports: [
    SESSION_RESOLVER,
    SESSION_REVOCATION,
    AUTH_CONFIG,
    SessionService,
    PasswordService,
    TotpService,
    AuthService,
  ],
})
export class AuthModule {}
