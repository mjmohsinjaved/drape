import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_SHORTLIST_NOTE_LENGTH } from '@api/modules/shortlist/constants/shortlist.constants';
import { RejectReason } from '@api/modules/shortlist/enums/reject-reason.enum';
import { Verdict } from '@api/modules/shortlist/enums/verdict.enum';

/**
 * `POST /results/:resultId/verdict` — §5.12, C-20, C-21.
 *
 * The same write as `POST /shortlist`, reached from the render she is looking at. **There
 * is no `garmentId` on this body**, and that is the point: the piece is whichever one the
 * render is of, read from the row after the ownership check. A client cannot name a
 * different garment here, so it cannot record a verdict against a piece she never saw.
 *
 * `resultId` is likewise not a field — it is the path segment — so the render stored
 * beside the shortlist item is always the one she actually decided from.
 */
export class ResultVerdictDto {
  @ApiProperty({
    enum: Verdict,
    description: 'Love it / Maybe / Not for me (C-20).',
  })
  @IsEnum(Verdict)
  verdict: Verdict;

  @ApiPropertyOptional({
    enum: RejectReason,
    description:
      'The optional one-tap reason behind a "Not for me" (C-21). Ignored — and stored as ' +
      'null — for any other verdict, because a reason without a rejection is what would ' +
      'corrupt the A-38 rollup.',
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
}
