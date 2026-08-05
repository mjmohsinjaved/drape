import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { AppException, ErrorCode, Public, ResponseMessage, Role, Roles } from '@library/common';

import { LivenessResponseDto, ReadinessResponseDto } from '../dto/health-response.dto';
import { HealthService } from '../services/health.service';

/**
 * ARCHITECTURE §5.21.
 *
 * Both routes are anonymous by design — a load balancer cannot hold a session — so
 * both carry `@Public()` **and** the explicit `@Roles(Role.PUBLIC)` contract the
 * B-5 route-guard check requires.
 *
 * Throttling is **skipped** on both, per the §5.22 override table: a rate-limited
 * liveness probe takes a healthy instance out of rotation, and an orchestrator that
 * cannot get an answer stops routing traffic to a perfectly healthy process.
 *
 * §2.6 requires a `@Public()` route to declare its throttle policy explicitly, and
 * these two carry their `@SkipThrottle()` **on the handler** rather than relying on
 * the class-level one alone. That is the §5.22 declaration, made local and visible
 * next to the `@Public()` it qualifies; adding a `@Throttle()` beside it would be
 * dead metadata, because `@nestjs/throttler` checks the skip first and the two would
 * contradict each other. The class-level decorator stays as the default for anything
 * added here later.
 *
 * Neither response reveals configuration: no host, no path, no driver name, no
 * version of any dependency.
 */
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @Roles(Role.PUBLIC)
  @SkipThrottle()
  @ResponseMessage('Service is live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: LivenessResponseDto })
  liveness(): LivenessResponseDto {
    return this.healthService.liveness();
  }

  @Get('ready')
  @Public()
  @Roles(Role.PUBLIC)
  @SkipThrottle()
  @ResponseMessage('Service is ready')
  @ApiOperation({ summary: 'Readiness probe: database and storage root' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unreachable.' })
  async readiness(): Promise<ReadinessResponseDto> {
    const report = await this.healthService.readiness();

    if (report.status !== 'ok') {
      // 503 so orchestrators stop routing traffic here. `details` names which
      // dependency is down — never why, and never how it is configured.
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, {
        details: {
          database: report.database.status,
          storage: report.storage.status,
        },
      });
    }

    return report;
  }
}
