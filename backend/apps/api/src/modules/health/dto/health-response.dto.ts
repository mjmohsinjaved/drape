import { ApiProperty } from '@nestjs/swagger';

export type HealthState = 'ok' | 'degraded';
export type DependencyState = 'up' | 'down';

/**
 * One dependency check.
 *
 * **Never carries configuration**: no host, no path, no driver credential, no
 * connection string. A caller learns whether the dependency answered and how long
 * it took, and nothing else (§9.2, E-12).
 */
export class DependencyCheckDto {
  @ApiProperty({ enum: ['up', 'down'] })
  status: DependencyState;

  @ApiProperty({ description: 'Round-trip time of the probe, in milliseconds.' })
  latencyMs: number;
}

/** `GET /api/v1/health` — liveness (§5.21). */
export class LivenessResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status: HealthState;

  @ApiProperty({ description: 'Deployed API version.' })
  version: string;

  @ApiProperty({ description: 'Process uptime in whole seconds.' })
  uptimeSeconds: number;

  @ApiProperty({ description: 'Server time, ISO-8601 with timezone.' })
  timestamp: string;
}

/** `GET /api/v1/health/ready` — readiness (§5.21). */
export class ReadinessResponseDto extends LivenessResponseDto {
  @ApiProperty({ type: DependencyCheckDto })
  database: DependencyCheckDto;

  @ApiProperty({ type: DependencyCheckDto })
  storage: DependencyCheckDto;
}
