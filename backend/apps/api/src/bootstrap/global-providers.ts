import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import {
  CsrfGuard,
  GlobalExceptionFilter,
  RequestIdMiddleware,
  RequestLoggingMiddleware,
  ResponseTransformInterceptor,
  RolesGuard,
  SecurityHeadersMiddleware,
  SessionAuthGuard,
  StructuredLoggerService,
  UserThrottlerGuard,
} from '@library/common';

/**
 * ARCHITECTURE §2.7 — the guard chain, the response envelope and the exception
 * filter, registered once for every route.
 *
 * **Registration order is execution order.** The order below is fixed and must not
 * be reshuffled:
 *
 * 1. `CsrfGuard`         — double-submit check (skipped for GET/HEAD/OPTIONS and `@SkipCsrf()`).
 * 2. `UserThrottlerGuard`— per-user or per-IP rate limiting.
 * 3. `SessionAuthGuard`  — resolves the session and attaches `ICurrentUser` (skipped for `@Public()`).
 * 4. `RolesGuard`        — enforces the route's `@Roles(...)` contract.
 *
 * Object-level ownership is **not** checked here. The guard chain authorises the
 * route; the owning service authorises the row (§2.7, §9.2).
 *
 * The module is `@Global()` so `StructuredLoggerService` can be resolved by
 * `app.useLogger()` in `main.ts` and injected anywhere without a re-import.
 *
 * **Boot dependency:** `SessionAuthGuard` injects the `SESSION_RESOLVER` token from
 * `@library/common`. That token is bound by the `auth` module (W1+), which is the
 * only place allowed to read a `sessions` row (§2.7 step 3). Until `AuthModule` is
 * registered in `api.module.ts` and provides it, the container cannot construct
 * guard 3. No placeholder resolver is bound here on purpose: a stand-in that
 * silently authorises — or silently rejects — is worse than a failed boot.
 */
@Global()
@Module({
  providers: [
    {
      // Self-configures from LOG_LEVEL; the factory exists because the constructor
      // takes an options object Nest cannot resolve from the container.
      provide: StructuredLoggerService,
      useFactory: (): StructuredLoggerService =>
        new StructuredLoggerService({
          context: 'Drape',
          pretty: process.env.NODE_ENV === 'development',
        }),
    },
    { provide: APP_GUARD, useClass: CsrfGuard }, // 1
    { provide: APP_GUARD, useClass: UserThrottlerGuard }, // 2
    { provide: APP_GUARD, useClass: SessionAuthGuard }, // 3
    { provide: APP_GUARD, useClass: RolesGuard }, // 4
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [StructuredLoggerService],
})
export class GlobalProvidersModule implements NestModule {
  /**
   * `forRoutes('*')` applies to every route in the application, not only this
   * module's. Order matters: the request id has to exist before anything logs.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, SecurityHeadersMiddleware, RequestLoggingMiddleware)
      .forRoutes('*');
  }
}
