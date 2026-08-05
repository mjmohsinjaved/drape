import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

import { MAX_SHORTLIST_NOTE_LENGTH } from '../constants/shortlist.constants';
import { RejectReason } from '../enums/reject-reason.enum';
import { Verdict } from '../enums/verdict.enum';

/**
 * `PATCH /shortlist/:itemId` — "update the note or the verdict" (§5.13).
 *
 * `note` is explicitly nullable: clearing a note is a thing she does, and an optional
 * field that cannot be set to `null` gives her no way to do it. `@ValidateIf` lets
 * `null` through while still rejecting a number or an object.
 *
 * Rank is **not** here. Ordering moves through `POST /shortlist/reorder`, which takes
 * the whole set and renumbers it atomically — a per-item rank edit is how two rows
 * end up sharing a position.
 */
export class UpdateShortlistItemDto {
  @ApiPropertyOptional({
    enum: Verdict,
    description: 'Move the piece between Love it / Maybe / Not for me.',
  })
  @IsOptional()
  @IsEnum(Verdict)
  verdict?: Verdict;

  @ApiPropertyOptional({
    enum: RejectReason,
    nullable: true,
    description: 'C-21. Retained only while the verdict is "Not for me".',
  })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsEnum(RejectReason)
  rejectReason?: RejectReason | null;

  @ApiPropertyOptional({
    maxLength: MAX_SHORTLIST_NOTE_LENGTH,
    nullable: true,
    description: 'Per-item note (C-32). Send `null` to clear it.',
  })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORTLIST_NOTE_LENGTH)
  note?: string | null;
}
