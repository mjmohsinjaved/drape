import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_SHARE_LABEL_LENGTH } from '../constants/share.constants';

/**
 * `POST /share-links` — create a 30-day link (C-33, C-34, §5.14).
 *
 * There is nothing to choose but the label. The expiry is fixed at 30 days by C-34,
 * and the contents are her live shortlist — §4.21 has no snapshot table, so there is
 * no set of items to pick here either.
 */
export class CreateShareLinkDto {
  @ApiPropertyOptional({
    example: 'Ammi',
    maxLength: MAX_SHARE_LABEL_LENGTH,
    description:
      'Her own name for the link, so she can tell two of them apart. Never shown to ' +
      'recipients.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHARE_LABEL_LENGTH)
  label?: string;
}
