import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { MAX_SHORTLIST_NOTE_LENGTH } from '../constants/shortlist.constants';
import { RejectReason } from '../enums/reject-reason.enum';
import { Verdict } from '../enums/verdict.enum';

/**
 * `POST /shortlist` — record a verdict on a piece (C-20, C-21, §5.13).
 *
 * One payload covers all three verdicts because §4.20 makes them one row:
 *
 * > Every verdict from the result view (C-20) upserts one row keyed
 * > `(userId, garmentId)`. … Changing a verdict updates the same row. There is no
 * > second verdict column anywhere.
 *
 * So "add to shortlist" and "not for me" are the same call with a different
 * `verdict`, and posting twice for the same garment moves the existing row rather
 * than creating a duplicate.
 *
 * `verdict` defaults to `LOVE_IT`: §5.13 describes `POST /shortlist` as "add a
 * garment (equivalent to a `LOVE_IT` verdict)", which is what the Shortlist screen's
 * own add button means.
 */
export class RecordVerdictDto {
  @ApiProperty({ format: 'uuid', description: 'The piece the verdict is about.' })
  @IsUUID()
  garmentId: string;

  @ApiPropertyOptional({
    enum: Verdict,
    default: Verdict.LOVE_IT,
    description: 'Love it / Maybe / Not for me (C-20). Omitted means Love it.',
  })
  @IsOptional()
  @IsEnum(Verdict)
  verdict?: Verdict;

  @ApiPropertyOptional({
    enum: RejectReason,
    nullable: true,
    description:
      'The optional one-tap reason behind a "Not for me" (C-21). Ignored — and stored ' +
      'as null — for any other verdict, because a reason without a rejection is what ' +
      'would corrupt the A-38 rollup.',
  })
  @IsOptional()
  @IsEnum(RejectReason)
  rejectReason?: RejectReason;

  @ApiPropertyOptional({
    maxLength: MAX_SHORTLIST_NOTE_LENGTH,
    description: 'Per-item note (C-32).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORTLIST_NOTE_LENGTH)
  note?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The render she was looking at when she decided. Shown beside the item; ignored ' +
      'unless the render is one of her own.',
  })
  @IsOptional()
  @IsUUID()
  resultId?: string;
}
