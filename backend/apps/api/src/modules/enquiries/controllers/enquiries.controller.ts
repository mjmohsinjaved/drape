import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';

import { CreateEnquiryDto } from '../dto/create-enquiry.dto';
import { EnquiryIdParamDto } from '../dto/enquiry-params.dto';
import { EnquiryQueryDto } from '../dto/enquiry-query.dto';
import { ConsumerEnquiryResponseDto } from '../dto/enquiry-response.dto';
import { EnquiriesService } from '../services/enquiries.service';

/**
 * Her own enquiries — ARCHITECTURE §5.15, PRD C-3, C-35, C-36.
 *
 * **Every handler is `@Roles(Role.CONSUMER)`.** The admin inbox is a separate
 * controller under `/admin/enquiries`, so the routes that read every enquiry in the
 * system and the routes that read exactly one consumer's can never be confused during
 * a review.
 *
 * Two things are structurally absent from every response here: another consumer's
 * enquiry (ownership is re-checked on each read, and a cross-account request receives
 * the masked `ENQUIRY_NOT_FOUND`), and an internal note — `ConsumerEnquiryResponseDto`
 * has no field for one (A-24, §4.25).
 */
@ApiTags('Enquiries')
@Controller('enquiries')
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  @Post()
  @Roles(Role.CONSUMER)
  @ResponseMessage('Enquiry sent')
  @ApiOperation({
    summary: 'Submit: shortlist snapshot plus event, budget and a message (C-35)',
    description:
      'Requires a verified phone number (C-3) — otherwise PHONE_NOT_VERIFIED. Blocked ' +
      'while `enquiries.enabled` is off (A-30). The shortlist is snapshotted in her ' +
      'rank order with per-item notes (A-21), so later changes to it leave the enquiry ' +
      'exactly as she sent it.',
  })
  @ApiCreatedResponse({ type: ConsumerEnquiryResponseDto })
  @ApiStandardResponses({ conflict: true })
  submit(
    @Body() dto: CreateEnquiryDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ConsumerEnquiryResponseDto> {
    return this.enquiries.submit(user, dto);
  }

  @Get()
  @Roles(Role.CONSUMER)
  @ResponseMessage('Enquiries retrieved successfully')
  @ApiOperation({ summary: 'Her enquiry history with current status (C-36)' })
  @ApiOkResponse({ type: [ConsumerEnquiryResponseDto] })
  @ApiStandardResponses()
  list(
    @Query() query: EnquiryQueryDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<IPaginated<ConsumerEnquiryResponseDto>> {
    return this.enquiries.list(user, query);
  }

  @Get(':enquiryId')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Enquiry retrieved successfully')
  @ApiOperation({
    summary: 'One of her enquiries (C-36)',
    description: 'Internal notes are never included (A-24).',
  })
  @ApiOkResponse({ type: ConsumerEnquiryResponseDto })
  @ApiStandardResponses({ notFound: true })
  findOne(
    @Param() params: EnquiryIdParamDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ConsumerEnquiryResponseDto> {
    return this.enquiries.findOne(user, params.enquiryId);
  }
}
