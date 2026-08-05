import { ErrorCode, IS_PUBLIC_KEY, Role, ROLES_KEY } from '@library/common';

import { HealthController } from './health.controller';

import type { ReadinessResponseDto } from '../dto/health-response.dto';
import type { HealthService } from '../services/health.service';

/**
 * ARCHITECTURE §2.6 and §5.22.
 *
 * §2.6: "A `@Public()` route must still declare `@Roles(Role.PUBLIC)` … and must carry an
 * explicit `@Throttle()`." §5.22's override table answers that for these two routes with
 * **skipped** — a rate-limited liveness probe takes a healthy instance out of rotation, and an
 * orchestrator that cannot get an answer stops routing traffic to a process that is fine.
 *
 * The two rules meet at "declare the policy explicitly, on the handler". These handlers used
 * to inherit it from a class-level `@SkipThrottle()` alone, so a reader of either handler saw
 * `@Public()` with no throttle decision anywhere near it. A `@Throttle()` here would be dead
 * metadata — `@nestjs/throttler` checks the skip first — and two decorators contradicting each
 * other is worse than one that is merely distant. The explicit per-handler `@SkipThrottle()`
 * is the §5.22 declaration, made local.
 */
describe('HealthController — the §2.6 declarations (B-5)', () => {
  /**
   * `@nestjs/throttler` exports this only from a deep `dist/` path, and reaching into another
   * package's build output is not something a test should teach. `SkipThrottle()` writes one
   * key per named throttler — `THROTTLER:SKIP` + the name — and `default` is the name the
   * global registration uses.
   */
  const THROTTLER_SKIP_DEFAULT = 'THROTTLER:SKIPdefault';

  const handlers = [
    ['liveness', HealthController.prototype.liveness],
    ['readiness', HealthController.prototype.readiness],
  ] as const;

  it.each(handlers)('%s declares @Public()', (_name, handler) => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  it.each(handlers)('%s declares @Roles(Role.PUBLIC), not merely @Public()', (_name, handler) => {
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([Role.PUBLIC]);
  });

  it.each(handlers)(
    '%s carries its throttle policy on the handler, not only on the class',
    (_name, handler) => {
      expect(Reflect.getMetadata(THROTTLER_SKIP_DEFAULT, handler)).toBe(true);
    },
  );

  it('still answers 503 with the failing dependency named, and nothing else', async () => {
    const report = {
      status: 'degraded',
      database: { status: 'down' },
      storage: { status: 'ok' },
    } as unknown as ReadinessResponseDto;

    const controller = new HealthController({
      readiness: jest.fn().mockResolvedValue(report),
    } as unknown as HealthService);

    await expect(controller.readiness()).rejects.toMatchObject({
      errorCode: ErrorCode.SERVICE_UNAVAILABLE,
      details: { database: 'down', storage: 'ok' },
    });
  });
});
