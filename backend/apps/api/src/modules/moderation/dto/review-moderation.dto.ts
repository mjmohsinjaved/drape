import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_DECISION_NOTE_LENGTH } from '../constants/moderation.constants';

/**
 * `POST /admin/moderation/:itemId/approve` and `.../reject` (A-34, §5.17).
 *
 * One DTO for both verbs, because the decision is in the path and the only thing an
 * admin adds to it is a note. The note is **internal**: it lands on
 * `moderation_items.decisionNote` and in the audit row, and it never reaches the
 * consumer. §8.3 fixes what she is told on a rejection — a neutral message that
 * neither accuses her nor explains the heuristic — and letting a moderator's wording
 * through would break that in both directions.
 */
export class ReviewModerationItemDto {
  @ApiPropertyOptional({
    maxLength: MAX_DECISION_NOTE_LENGTH,
    example: 'Upstream flag is a false positive — the pattern on the dupatta, not skin.',
    description: 'Internal. Stored on the item and in the audit row; never shown to the consumer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DECISION_NOTE_LENGTH)
  note?: string;
}
