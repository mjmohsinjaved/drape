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
 * Throttling is explicitly **skipped** on both, per the §5.22 override table: a
 * rate-limited liveness probe takes a healthy instance out of rotation.
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
  @ResponseMessage('Service is live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: LivenessResponseDto })
  liveness(): LivenessResponseDto {
    return this.healthService.liveness();
  }

  @Get('ready')
  @Public()
  @Roles(Role.PUBLIC)
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
