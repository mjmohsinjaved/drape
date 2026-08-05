import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ConsentStatus } from '../enums/consent-status.enum';

/**
 * `GET /consents/me` — one question, one answer (§5.10).
 *
 * The C-11 gate and the §8.1 step-3 guard chain both ask it, so neither re-implements
 * "is her consent current?" and the two can never disagree.
 */
export class ConsentStatusResponseDto {
  @ApiProperty({ enum: ConsentStatus })
  status: ConsentStatus;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'When she last consented, at any version. Null when she never has.',
  })
  grantedAt: Date | null;

  @ApiProperty({
    example: '2026.08.1',
    description: 'The version currently in force — the one she must be at to pass.',
  })
  policyVersion: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026.07.1',
    description: 'The version she actually agreed to. Differs from `policyVersion` when STALE.',
  })
  consentedPolicyVersion: string | null;
}
