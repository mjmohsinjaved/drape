import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * `:jobId` on every `/tryon/jobs/**` route (§5.11).
 *
 * Param DTOs rather than `ParseUUIDPipe` so a malformed id stays inside the §2.3
 * validation envelope instead of returning a bare 400.
 */
export class JobIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  jobId: string;
}

/** `:batchId` on the A-12 bulk test-render routes (§5.11). */
export class BatchIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  batchId: string;
}
