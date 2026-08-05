import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';

import { ConsumerQueryDto } from '../dto/consumer-query.dto';
import {
  ConsumerRenderQueryDto,
  ConsumerRenderResponseDto,
} from '../dto/consumer-render-response.dto';
import {
  ConsumerDetailResponseDto,
  ConsumerListItemResponseDto,
} from '../dto/consumer-response.dto';
import {
  ConsumerShortlistItemResponseDto,
  ConsumerShortlistQueryDto,
} from '../dto/consumer-shortlist-response.dto';
import { DeleteConsumerDto, DeletionReceiptResponseDto } from '../dto/delete-consumer.dto';
import { SetQuotaOverrideDto } from '../dto/set-quota-override.dto';
import { SuspendConsumerDto } from '../dto/suspend-consumer.dto';
import { UserIdParamDto } from '../dto/user-id-param.dto';
import { AdminConsumersService } from '../services/admin-consumers.service';

/**
 * Consumer management — ARCHITECTURE §5.2, PRD A-16 … A-20.
 *
 * **Every handler is `@Roles(Role.ADMIN)`**, and the spec beside this file asserts
 * a consumer session is refused on each one (S-11, E-7).
 *
 * There is no route here that returns a person photo, because there is no service
 * method that can produce one: `ConsumerQueryService` holds no `person_photos`
 * repository (S-10). `GET :userId/renders` is the single admin path to a render and
 * it reaches them only through `enquiry_items`.
 */
@ApiTags('Admin · Consumers')
@Controller('admin/consumers')
export class AdminConsumersController {
  constructor(private readonly consumers: AdminConsumersService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Consumers retrieved successfully')
  @ApiOperation({
    summary:
      'Consumer list: name, email, phone, signup, last active, generations this month, ' +
      'shortlist size, enquiry count, status (A-16)',
  })
  @ApiOkResponse({ type: [ConsumerListItemResponseDto] })
  @ApiStandardResponses()
  list(@Query() query: ConsumerQueryDto): Promise<IPaginated<ConsumerListItemResponseDto>> {
    return this.consumers.list(query);
  }

  @Get(':userId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Consumer retrieved successfully')
  @ApiOperation({ summary: 'Consumer detail. Never includes her photo (A-17, S-10).' })
  @ApiOkResponse({ type: ConsumerDetailResponseDto })
  @ApiStandardResponses({ notFound: true })
  findOne(@Param() params: UserIdParamDto): Promise<ConsumerDetailResponseDto> {
    return this.consumers.findOne(params.userId);
  }

  @Get(':userId/renders')
  @Roles(Role.ADMIN)
  @ResponseMessage('Renders retrieved successfully')
  @ApiOperation({
    summary: 'Renders attached to her enquiries only, via `enquiry_items` (A-17, S-10)',
  })
  @ApiOkResponse({ type: [ConsumerRenderResponseDto] })
  @ApiStandardResponses({ notFound: true })
  listRenders(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: UserIdParamDto,
    @Query() query: ConsumerRenderQueryDto,
  ): Promise<IPaginated<ConsumerRenderResponseDto>> {
    return this.consumers.listRenders(actor, params.userId, query);
  }

  @Get(':userId/shortlist')
  @Roles(Role.ADMIN)
  @ResponseMessage('Shortlist retrieved successfully')
  @ApiOperation({ summary: 'Her shortlisted garments (A-17)' })
  @ApiOkResponse({ type: [ConsumerShortlistItemResponseDto] })
  @ApiStandardResponses({ notFound: true })
  listShortlist(
    @Param() params: UserIdParamDto,
    @Query() query: ConsumerShortlistQueryDto,
  ): Promise<IPaginated<ConsumerShortlistItemResponseDto>> {
    return this.consumers.listShortlist(params.userId, query);
  }

  @Patch(':userId/quota')
  @Roles(Role.ADMIN)
  @ResponseMessage('Quota override updated')
  @ApiOperation({ summary: 'Set or clear `monthlyQuotaOverride` (A-18)' })
  @ApiOkResponse({ type: ConsumerDetailResponseDto })
  @ApiStandardResponses({ notFound: true })
  setQuota(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: UserIdParamDto,
    @Body() dto: SetQuotaOverrideDto,
  ): Promise<ConsumerDetailResponseDto> {
    return this.consumers.setQuotaOverride(actor, params.userId, dto);
  }

  @Post(':userId/suspend')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ResponseMessage('Account suspended')
  @ApiOperation({ summary: 'Suspend with a required reason; revokes sessions (A-19)' })
  @ApiOkResponse({ type: ConsumerDetailResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  suspend(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: UserIdParamDto,
    @Body() dto: SuspendConsumerDto,
  ): Promise<ConsumerDetailResponseDto> {
    return this.consumers.suspend(actor, params.userId, dto);
  }

  @Post(':userId/unsuspend')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ResponseMessage('Suspension lifted')
  @ApiOperation({ summary: 'Lift a suspension' })
  @ApiOkResponse({ type: ConsumerDetailResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  unsuspend(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: UserIdParamDto,
  ): Promise<ConsumerDetailResponseDto> {
    return this.consumers.unsuspend(actor, params.userId);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(Role.ADMIN)
  @ResponseMessage('Deletion scheduled')
  @ApiOperation({
    summary: 'Delete the consumer and all data. Requires typing the name (D-17).',
    description:
      'Returns 202 with the `deletion_log` confirmation record. The purge itself is executed ' +
      'by the retention module and completes within `DELETION_SLA_HOURS` (A-20, §9.3).',
  })
  @ApiOkResponse({ type: DeletionReceiptResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  requestDeletion(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: UserIdParamDto,
    @Body() dto: DeleteConsumerDto,
  ): Promise<DeletionReceiptResponseDto> {
    return this.consumers.requestDeletion(actor, params.userId, dto);
  }
}
