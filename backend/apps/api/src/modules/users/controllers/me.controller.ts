import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { ConsumerProfileResponseDto, UpdateConsumerProfileDto } from '../dto/consumer-profile.dto';
import { MeResponseDto } from '../dto/me-response.dto';
import {
  NotificationPreferencesResponseDto,
  UpdateNotificationPreferencesDto,
} from '../dto/notification-preferences.dto';
import { UpdateMeDto } from '../dto/update-me.dto';
import { MeService } from '../services/me.service';

/**
 * The caller's own account — ARCHITECTURE §5.2, PRD C-2 and C-7.
 *
 * **No route here takes a user id.** Ownership comes from `@CurrentUser()`, which
 * only `SessionAuthGuard` populates from the session row (S-3) — §9.2's "never infer
 * ownership from an unguessable id" is satisfied structurally, because there is no
 * id to infer from.
 *
 * `/me` and the notification preferences are `ANY`; the C-2 profile fields are
 * `CONSUMER`, matching §5.2.
 */
@ApiTags('Me')
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ResponseMessage('Profile retrieved successfully')
  @ApiOperation({ summary: "The caller's own profile" })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiStandardResponses()
  findMe(@CurrentUser() caller: ICurrentUser): Promise<MeResponseDto> {
    return this.me.findMe(caller);
  }

  @Patch()
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ResponseMessage('Profile updated successfully')
  @ApiOperation({
    summary: 'Update name, phone, locale (C-7)',
    description:
      'Email, role and status are not writable here. Changing the phone number clears its ' +
      'verification, so C-3 asks for it again before the next enquiry.',
  })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiStandardResponses({ conflict: true })
  updateMe(@CurrentUser() caller: ICurrentUser, @Body() dto: UpdateMeDto): Promise<MeResponseDto> {
    return this.me.updateMe(caller, dto);
  }

  @Get('profile')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Profile retrieved successfully')
  @ApiOperation({ summary: 'Event date, type, budget band, preferred categories (C-2)' })
  @ApiOkResponse({ type: ConsumerProfileResponseDto })
  @ApiStandardResponses()
  findMyProfile(@CurrentUser() caller: ICurrentUser): Promise<ConsumerProfileResponseDto> {
    return this.me.findMyProfile(caller);
  }

  @Patch('profile')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Profile updated successfully')
  @ApiOperation({
    summary: 'Update those fields (C-2)',
    description:
      'Every field is optional. Omitting a key leaves it alone; sending `null` clears it. ' +
      '`monthlyQuotaOverride` is an admin control (A-18) and is not writable here.',
  })
  @ApiOkResponse({ type: ConsumerProfileResponseDto })
  @ApiStandardResponses({ conflict: true })
  updateMyProfile(
    @CurrentUser() caller: ICurrentUser,
    @Body() dto: UpdateConsumerProfileDto,
  ): Promise<ConsumerProfileResponseDto> {
    return this.me.updateMyProfile(caller, dto);
  }

  @Get('notification-preferences')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ResponseMessage('Preferences retrieved successfully')
  @ApiOperation({ summary: 'Read notification preferences (C-7)' })
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  @ApiStandardResponses()
  findMyNotificationPreferences(
    @CurrentUser() caller: ICurrentUser,
  ): Promise<NotificationPreferencesResponseDto> {
    return this.me.findMyNotificationPreferences(caller);
  }

  @Patch('notification-preferences')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ResponseMessage('Preferences updated successfully')
  @ApiOperation({ summary: 'Update notification preferences (C-7)' })
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  @ApiStandardResponses()
  updateMyNotificationPreferences(
    @CurrentUser() caller: ICurrentUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponseDto> {
    return this.me.updateMyNotificationPreferences(caller, dto);
  }
}
