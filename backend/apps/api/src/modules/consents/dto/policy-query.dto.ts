import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional } from 'class-validator';

import { Locale } from '@api/modules/users/enums/locale.enum';

/** `GET /consents/policy?locale=UR` — which translation the gate should render (C-41). */
export class PolicyQueryDto {
  @ApiPropertyOptional({ enum: Locale, default: Locale.EN })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}
