import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

/**
 * `POST /results/:resultId/marketing-opt-in` — §9.3.
 *
 * The flag is explicit and required. There is no default and no "if omitted, assume
 * yes": §9.3 asks for a **per-render explicit opt-in** for brand marketing use, and an
 * optional boolean is how an opt-in quietly becomes an opt-out-if-you-notice.
 */
export class MarketingOptInDto {
  @ApiProperty({ description: 'true to allow this render in brand marketing; false to revoke.' })
  @IsBoolean()
  optIn: boolean;
}
