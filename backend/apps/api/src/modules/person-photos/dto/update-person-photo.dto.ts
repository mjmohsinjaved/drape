import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

import { MAX_PHOTO_LABEL_LENGTH } from '../constants/person-photo.constants';

/**
 * `PATCH /person-photos/:photoId` — rename the label (§5.9).
 *
 * The label and nothing else. `isActive` has its own endpoint because activating is a
 * different operation with a different invariant behind it (exactly one active photo,
 * §4.16), and folding it into a general-purpose PATCH would make that invariant
 * reachable from a request that looks like a rename.
 *
 * `null` clears the label; omitting the field leaves it alone. `@ValidateIf` is what
 * distinguishes the two — `@IsOptional()` alone would treat an explicit `null` as
 * "absent" and silently ignore it.
 */
export class UpdatePersonPhotoDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'A new label, or null to clear it.',
    maxLength: MAX_PHOTO_LABEL_LENGTH,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(MAX_PHOTO_LABEL_LENGTH)
  label?: string | null;
}
