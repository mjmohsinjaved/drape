import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ResultResponseDto } from '@api/modules/results';

import { JobOrigin } from '../enums/job-origin.enum';
import { JobStatus } from '../enums/job-status.enum';

/**
 * `POST /tryon` and `GET /tryon/jobs/:jobId` — §5.11's `{ jobId, status, cacheHit,
 * result? }`.
 *
 * The same DTO serves the synchronous response and the polling fallback, because they
 * describe the same thing and a client that has to parse two shapes for one concept
 * will eventually parse one of them wrong.
 *
 * `result` is present as soon as the job succeeds — which for a cache hit is in the
 * `POST` response itself (§9.1: p95 under 400ms), so a client that got a hit never
 * needs to open a stream at all.
 */
export class TryOnJobResponseDto {
  @ApiProperty({ format: 'uuid' })
  jobId: string;

  @ApiProperty({ enum: JobStatus })
  status: JobStatus;

  @ApiProperty({ enum: JobOrigin })
  origin: JobOrigin;

  @ApiProperty({ description: 'True when the render came from the §3.7 cache — no charge (C-22).' })
  cacheHit: boolean;

  @ApiProperty({ format: 'uuid', nullable: true })
  garmentId: string | null;

  @ApiProperty({ description: 'Upstream attempts spent. 0 for a cache hit.' })
  attempts: number;

  @ApiProperty({ nullable: true, description: 'End-to-end duration in ms, once finished.' })
  durationMs: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'An `ErrorCode` value when the job failed (§8.3).',
  })
  errorCode: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The §8.3 consumer copy for `errorCode`. Never an upstream message.',
  })
  message: string | null;

  @ApiPropertyOptional({ type: ResultResponseDto, nullable: true })
  result: ResultResponseDto | null;

  @ApiProperty()
  createdAt: Date;
}
