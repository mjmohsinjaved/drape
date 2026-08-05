import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import { MAX_VOTE_COMMENT_LENGTH, MAX_VOTER_LABEL_LENGTH } from '../constants/share.constants';
import { Reaction } from '../enums/reaction.enum';

/**
 * `POST /share/:token/votes` — react and leave one comment per item (C-33, §5.14).
 *
 * No account, by requirement. The visitor types a name; the API pairs it with a
 * first-party cookie whose sha256 becomes `votes.voterFingerprint` (§4.22). The name
 * is a label the owner reads, never an identity the API trusts — it authorises
 * nothing, and two visitors may honestly share one.
 *
 * `comment` is optional and **once**. A second comment on the same piece by the same
 * visitor is `VOTE_ALREADY_CAST`; changing the reaction updates the row (§4.22).
 */
export class CastVoteDto {
  @ApiProperty({ format: 'uuid', description: 'A piece on this shared shortlist.' })
  @IsUUID()
  garmentId: string;

  @ApiProperty({ enum: Reaction, description: 'Heart, unsure or no (C-33).' })
  @IsEnum(Reaction)
  reaction: Reaction;

  @ApiProperty({
    example: 'Ammi',
    maxLength: MAX_VOTER_LABEL_LENGTH,
    description: 'The name the visitor types, so the owner knows whose reaction it is.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_VOTER_LABEL_LENGTH)
  voterLabel: string;

  @ApiPropertyOptional({
    maxLength: MAX_VOTE_COMMENT_LENGTH,
    description: 'One comment per item (C-33). Sending a second one is refused, not overwritten.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_VOTE_COMMENT_LENGTH)
  comment?: string;
}
