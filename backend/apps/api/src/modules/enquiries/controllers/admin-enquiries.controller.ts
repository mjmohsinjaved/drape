import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
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

import { EnquiryIdParamDto } from '../dto/enquiry-params.dto';
import { AdminEnquiryQueryDto } from '../dto/enquiry-query.dto';
import {
  AdminEnquiryResponseDto,
  AdminEnquirySummaryDto,
  EnquiryNoteResponseDto,
  WhatsAppReplyDto,
} from '../dto/enquiry-response.dto';
import {
  AssignEnquiryDto,
  CreateEnquiryNoteDto,
  UpdateEnquiryStatusDto,
} from '../dto/update-enquiry.dto';
import { AdminEnquiriesService } from '../services/admin-enquiries.service';
import { EnquiryExportService } from '../services/enquiry-export.service';
import { WhatsAppReplyService } from '../services/whatsapp-reply.service';

import type { CsvSink } from '../services/enquiry-export.service';

/** The slice of the Express response the CSV export writes to. */
export interface CsvResponse extends CsvSink {
  setHeader(name: string, value: string): unknown;
}

/**
 * The admin inbox — ARCHITECTURE §5.15, PRD A-21 … A-26.
 *
 * **Every handler is `@Roles(Role.ADMIN)`**, and the spec beside this file asserts it
 * by walking the controller's own route table rather than by naming handlers — so a
 * route added tomorrow is covered the moment it exists (S-11, E-7).
 *
 * `GET /admin/enquiries/:enquiryId` is the single place in the product where an admin
 * receives a URL for a consumer's render, and it is reachable only because she chose
 * to send that piece: the query joins `enquiry_items → tryon_results` and nothing else
 * (S-10, §4.24). Her **photograph** is unreachable from every route in this file —
 * `person_photos` has no repository in this module at all.
 */
@ApiTags('Enquiries (admin)')
@Controller('admin/enquiries')
export class AdminEnquiriesController {
  constructor(
    private readonly enquiries: AdminEnquiriesService,
    private readonly exports: EnquiryExportService,
    private readonly whatsapp: WhatsAppReplyService,
  ) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Enquiries retrieved successfully')
  @ApiOperation({
    summary: 'Inbox with status filter, stale-after-24h flag and search (A-25)',
    description:
      '`stale=true` returns enquiries nobody has touched for more than 24 hours. ' +
      'Search spans the reference, the consumer’s name and her email.',
  })
  @ApiOkResponse({ type: [AdminEnquirySummaryDto] })
  @ApiStandardResponses()
  list(@Query() query: AdminEnquiryQueryDto): Promise<IPaginated<AdminEnquirySummaryDto>> {
    return this.enquiries.list(query);
  }

  /**
   * Declared before `:enquiryId` so `export` is matched as a literal segment.
   *
   * Streams, and therefore takes the raw response: `@Res()` without `passthrough`
   * means Nest hands the socket over, so the rows go out as they are read and the
   * §2.3 envelope is deliberately not applied. A CSV inside a JSON envelope is not a
   * CSV.
   */
  @Get('export')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'CSV export of the filtered set (A-26)',
    description:
      'Streamed a page at a time, so peak memory does not grow with the result set. ' +
      'Every export writes an ENQUIRY_EXPORTED audit row.',
  })
  @ApiOkResponse({
    description: 'The CSV.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiStandardResponses()
  async export(
    @Query() query: AdminEnquiryQueryDto,
    @CurrentUser() user: ICurrentUser,
    @Res() response: CsvResponse,
  ): Promise<void> {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${this.exports.filenameFor()}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    await this.exports.streamCsv(user, query, response);
    response.end();
  }

  @Get(':enquiryId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Enquiry retrieved successfully')
  @ApiOperation({
    summary: 'Contact details, event, budget, ranked items with renders and notes (A-21)',
    description:
      'The render URLs are signed to the requesting admin and exist only because an ' +
      '`enquiry_items` row does (S-10, §4.24). Internal notes have their own route.',
  })
  @ApiOkResponse({ type: AdminEnquiryResponseDto })
  @ApiStandardResponses({ notFound: true })
  findOne(
    @Param() params: EnquiryIdParamDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<AdminEnquiryResponseDto> {
    return this.enquiries.findOne(user, params.enquiryId);
  }

  @Patch(':enquiryId/status')
  @Roles(Role.ADMIN)
  @ResponseMessage('Status updated')
  @ApiOperation({
    summary: 'Move status; a reason is required for CLOSED_LOST (A-22)',
    description:
      'Refused with INVALID_ENQUIRY_TRANSITION when the move is not on the §4.23 ' +
      'transition table, and with ENQUIRY_LOST_REASON_REQUIRED when a lost close ' +
      'carries no reason.',
  })
  @ApiOkResponse({ type: AdminEnquiryResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  changeStatus(
    @Param() params: EnquiryIdParamDto,
    @Body() dto: UpdateEnquiryStatusDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<AdminEnquiryResponseDto> {
    return this.enquiries.changeStatus(user, params.enquiryId, dto);
  }

  @Patch(':enquiryId/assign')
  @Roles(Role.ADMIN)
  @ResponseMessage('Enquiry assigned')
  @ApiOperation({ summary: 'Assign to an admin, or send null to unassign (§5.15)' })
  @ApiOkResponse({ type: AdminEnquiryResponseDto })
  @ApiStandardResponses({ notFound: true })
  assign(
    @Param() params: EnquiryIdParamDto,
    @Body() dto: AssignEnquiryDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<AdminEnquiryResponseDto> {
    return this.enquiries.assign(user, params.enquiryId, dto);
  }

  @Get(':enquiryId/notes')
  @Roles(Role.ADMIN)
  @ResponseMessage('Notes retrieved successfully')
  @ApiOperation({
    summary: 'Internal notes (A-24)',
    description:
      'Admin only. No consumer route returns these, and no consumer DTO has a field for one.',
  })
  @ApiOkResponse({ type: [EnquiryNoteResponseDto] })
  @ApiStandardResponses({ notFound: true })
  listNotes(@Param() params: EnquiryIdParamDto): Promise<EnquiryNoteResponseDto[]> {
    return this.enquiries.listNotes(params.enquiryId);
  }

  @Post(':enquiryId/notes')
  @Roles(Role.ADMIN)
  @ResponseMessage('Note added')
  @ApiOperation({
    summary: 'Add an internal note (A-24)',
    description: 'Append-only (§4.25): there is no edit route and no delete route.',
  })
  @ApiCreatedResponse({ type: EnquiryNoteResponseDto })
  @ApiStandardResponses({ notFound: true })
  addNote(
    @Param() params: EnquiryIdParamDto,
    @Body() dto: CreateEnquiryNoteDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<EnquiryNoteResponseDto> {
    return this.enquiries.addNote(user, params.enquiryId, dto);
  }

  @Get(':enquiryId/whatsapp-link')
  @Roles(Role.ADMIN)
  @ResponseMessage('Reply link built')
  @ApiOperation({
    summary: 'A wa.me deep link pre-filled with her name and top pieces (A-23)',
    description:
      'Built from the **brand** WhatsApp number in Settings (A-27). An admin’s own ' +
      'number is never used and never returned.',
  })
  @ApiOkResponse({ type: WhatsAppReplyDto })
  @ApiStandardResponses({ notFound: true })
  async whatsappLink(@Param() params: EnquiryIdParamDto): Promise<WhatsAppReplyDto> {
    const enquiry = await this.enquiries.load(params.enquiryId);
    const items = await this.enquiries.loadItems(enquiry.id);
    return this.whatsapp.buildReply(enquiry, items);
  }
}
