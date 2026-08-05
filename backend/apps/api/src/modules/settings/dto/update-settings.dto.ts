import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { SETTINGS_REGISTRY } from '@api/shared/constants/settings-keys.constant';

/** `settings.key` is `varchar(80)` (§4.28). */
const MAX_KEY_LENGTH = 80;

/**
 * One key/value change.
 *
 * `key` is **not** narrowed with `@IsIn(...)` here on purpose. §2.4 gives an unknown
 * key its own code — `SETTINGS_KEY_UNKNOWN`, "Unknown setting." — and a generic
 * `VALIDATION_ERROR` would lose that. The registry check happens in the service,
 * where it can throw the right thing.
 *
 * `value` carries `@Allow()` rather than a type decorator because its legal shape
 * depends on the key: `CustomValidationPipe` runs with `whitelist: true`, which would
 * otherwise strip an undecorated property before the service ever sees it. The real
 * validation is `validateSettingValue()`, driven by the registry.
 */
export class SettingChangeDto {
  @ApiProperty({ example: 'quota.defaultMonthly', description: 'A key from the closed registry.' })
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  key: string;

  @ApiProperty({
    description: "Validated against the key's registry definition. `null` clears an optional key.",
    example: 20,
  })
  @Allow()
  value: unknown;
}

/**
 * `PATCH /settings` (§5.4) — update one or more keys.
 *
 * A batch, not a single key, because the A-27…A-30 admin screens save a section at a
 * time: brand basics, quota and verification, the budget and its warning threshold,
 * the three toggles. Every key in the batch is validated before any of them is
 * written, and the write goes in as one `save()`, so a rejected value cannot leave a
 * half-applied section behind.
 */
export class UpdateSettingsDto {
  @ApiProperty({ type: [SettingChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SETTINGS_REGISTRY.length)
  @ValidateNested({ each: true })
  @Type(() => SettingChangeDto)
  changes: SettingChangeDto[];
}
