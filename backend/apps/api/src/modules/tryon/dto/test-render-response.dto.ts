import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';

import { JobStatus } from '../enums/job-status.enum';

/** `GET /admin/reference-models` — A-11, §4.15. */
export class ReferenceModelResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Reference model — mid-tone, front-facing' })
  label: string;

  @ApiProperty({ nullable: true, description: 'Signed URL for the thumbnail (§3.4).' })
  thumbnailUrl: string | null;

  @ApiProperty()
  isDefault: boolean;

  @ApiProperty()
  position: number;
}

/**
 * The A-11 approval screen's payload: the render beside the source, plus the state.
 *
 * §5.11 — "the result is shown beside the source image for approval and stored on the
 * garment". Both URLs are signed and expiring; neither is a storage key.
 */
export class TestRenderResponseDto {
  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  jobId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  resultId: string | null;

  @ApiProperty({ enum: TestRenderState })
  testRenderState: TestRenderState;

  @ApiProperty({ nullable: true, description: 'Signed URL for the try-on source image.' })
  sourceUrl: string | null;

  @ApiProperty({ nullable: true, description: 'Signed URL for the generated render.' })
  renderUrl: string | null;

  @ApiProperty({ description: 'True once an admin has approved it — unblocks publishing (A-11).' })
  publishable: boolean;

  @ApiPropertyOptional({ nullable: true })
  errorCode: string | null;
}

/** One item of an A-12 batch, for the D-16 per-item results table. */
export class TestRenderBatchItemDto {
  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  jobId: string | null;

  @ApiProperty({ enum: JobStatus, nullable: true })
  status: JobStatus | null;

  @ApiProperty({ nullable: true })
  errorCode: string | null;
}

/** `GET /admin/tryon/batches/:batchId` — progress and a success/failure summary (D-16). */
export class TestRenderBatchResponseDto {
  @ApiProperty({ format: 'uuid' })
  batchId: string;

  @ApiProperty()
  total: number;

  @ApiProperty()
  succeeded: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ description: 'Queued plus running.' })
  pending: number;

  @ApiProperty({ type: [TestRenderBatchItemDto] })
  items: TestRenderBatchItemDto[];
}

/**
 * A-12 — the cost estimate shown before a bulk run.
 *
 * `generations` is what will actually be spent: garments that already carry an approved
 * render are excluded, because re-rendering them would burn budget to learn nothing.
 */
export class TestRenderEstimateResponseDto {
  @ApiProperty({ description: 'Garments in the selection.' })
  selected: number;

  @ApiProperty({ description: 'Generations this run would spend.' })
  generations: number;

  @ApiProperty({ description: 'Already carrying an approved test render — skipped.' })
  alreadyApproved: number;

  @ApiProperty({ description: 'Remaining monthly platform budget before the run (A-29).' })
  budgetRemaining: number;

  @ApiProperty({ description: 'False when the run would exceed the remaining budget.' })
  withinBudget: boolean;
}
