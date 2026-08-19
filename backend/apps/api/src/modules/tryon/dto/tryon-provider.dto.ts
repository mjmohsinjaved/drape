import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional } from 'class-validator';

import { OpenAiImageQuality, TryOnDriverName } from '@api/config/env.validation';

export class SelectTryOnProviderDto {
  @ApiProperty({
    enum: TryOnDriverName,
    description:
      'The upstream that will serve the next generation. Must be configured on this ' +
      'deployment — GET /admin/tryon/providers reports which are.',
  })
  @IsEnum(TryOnDriverName)
  driver: TryOnDriverName;

  @ApiPropertyOptional({
    enum: OpenAiImageQuality,
    description:
      'OpenAI render quality, the cost and latency dial. Ignored by the other drivers, ' +
      'but accepted alongside any of them so the console can save both in one click.',
  })
  @IsOptional()
  @IsEnum(OpenAiImageQuality)
  quality?: OpenAiImageQuality;
}

export class TryOnProviderOptionDto {
  @ApiProperty({ enum: TryOnDriverName })
  driver: TryOnDriverName;

  @ApiProperty({ description: 'Human label for the dropdown.' })
  label: string;

  @ApiProperty({
    description:
      'What choosing it means — cost, speed and the caveat that matters for this ' +
      'upstream. Shown under the option rather than buried in documentation.',
  })
  description: string;

  @ApiProperty({
    description:
      'True when this deployment holds every credential the driver needs. A false option ' +
      'is offered but disabled: the switch endpoint refuses it, and saying *why* it is ' +
      'unavailable is more useful than hiding it (D-5 permission-denied).',
  })
  configured: boolean;

  @ApiProperty({ description: 'True for the driver currently serving generations.' })
  active: boolean;

  @ApiProperty({
    description: 'True for the TRYON_DRIVER boot default — what an unset override falls to.',
  })
  bootDefault: boolean;

  @ApiProperty({ description: 'True when the driver spends real money per render.' })
  billable: boolean;

  @ApiProperty({
    description:
      'False for a driver the console may not switch to. Only ever false for the mock, and ' +
      'only ever *present* at all when the mock is already live — the panel lists it then so ' +
      'it cannot misreport what is running, but the row is read-only.',
  })
  selectable: boolean;
}

export class TryOnProviderStateDto {
  @ApiProperty({ enum: TryOnDriverName, description: 'The driver serving generations now.' })
  active: TryOnDriverName;

  @ApiProperty({
    description:
      'True when the active driver comes from the TRYON_DRIVER environment default rather ' +
      'than from an admin override, so the screen can say "following the environment".',
  })
  followingEnvironment: boolean;

  @ApiProperty({ enum: OpenAiImageQuality, description: 'Current OpenAI quality dial.' })
  quality: OpenAiImageQuality;

  @ApiProperty({ type: [TryOnProviderOptionDto] })
  providers: TryOnProviderOptionDto[];
}
