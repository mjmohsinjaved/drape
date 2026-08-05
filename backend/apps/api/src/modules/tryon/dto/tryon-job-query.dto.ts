import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import { JobStatus } from '../enums/job-status.enum';

/** The columns jobs may be sorted by. Narrowed per §2.8 — never interpolated. */
export const JOB_SORT_KEYS = ['createdAt'] as const;

export type JobSortKey = (typeof JOB_SORT_KEYS)[number];

/**
 * `GET /tryon/jobs` — the results tray (C-19, §5.11).
 *
 * "She can keep browsing; results collect in a tray and notify inline." The tray is
 * this list: recent and in-flight jobs, newest first, with the finished ones carrying
 * their result. Filtering by status is how the tray shows "still working" separately
 * from "ready".
 */
export class TryOnJobQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: JobStatus, description: 'Only jobs in this state.' })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @ApiProperty({ enum: JOB_SORT_KEYS, default: 'createdAt', required: false })
  @IsOptional()
  @IsIn(JOB_SORT_KEYS)
  override sortBy: JobSortKey = 'createdAt';
}
