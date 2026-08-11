import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ApiStandardResponses,
  CurrentUser,
  Public,
  ResponseMessage,
  Role,
  Roles,
  SkipCsrf,
  type ICurrentUser,
} from '@library/common';
import { UPLOAD_TICKET_HEADER } from '@library/storage';

import { CreateUploadTicketDto } from '../dto/create-upload-ticket.dto';
import { FileTokenParamDto } from '../dto/file-token-param.dto';
import {
  UploadResultResponseDto,
  UploadTicketResponseDto,
} from '../dto/upload-ticket-response.dto';
import { FileDownloadService } from '../services/file-download.service';
import { FileUploadService } from '../services/file-upload.service';
import { UploadTicketService } from '../services/upload-ticket.service';

import type { Request, Response } from 'express';

/**
 * ARCHITECTURE §5.20 — `files`. Every byte enters through `PUT /files/upload` (ticket in the
 * `X-Upload-Ticket` header) and leaves through `GET /files/:token`. `STORAGE_ROOT` sits outside
 * the repository and is never behind a static file handler (§3.2 requirement 8).
 */
@ApiTags('Files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly downloads: FileDownloadService,
    private readonly tickets: UploadTicketService,
    private readonly uploads: FileUploadService,
  ) {}

  @Get(':token')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Serve a stored object against an HMAC token (§3.4)',
    description:
      'A `sub`-scoped token additionally requires a session whose id matches the subject, so ' +
      "one consumer's render URL cannot be replayed by another account (PRD §9.2).",
  })
  @ApiOkResponse({
    description: 'The object, streamed.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiStandardResponses({ auth: false, notFound: true })
  async download(
    @Param() params: FileTokenParamDto,
    @CurrentUser() requester: ICurrentUser | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.downloads.open(params.token, requester);

    // §3.4 step 6. `ResponseTransformInterceptor` returns a `StreamableFile` untouched, so none
    // of this ends up inside a JSON envelope.
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', file.byteSize);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', file.cacheControl);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // A private object varies by who is asking; say so, in case anything between us and the
    // browser is willing to cache despite `private`.
    response.setHeader('Vary', 'Cookie');

    return new StreamableFile(file.stream);
  }

  /** §5.20 / §3.5 step 1. Rate limit from the §5.22 override table. */
  @Post('upload-ticket')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ResponseMessage('Upload ticket issued successfully')
  @ApiOperation({ summary: 'Issue a scoped, expiring upload ticket for a declared purpose (§3.5)' })
  @ApiOkResponse({ type: UploadTicketResponseDto })
  @ApiStandardResponses({ unprocessable: true })
  async createUploadTicket(
    @Body() dto: CreateUploadTicketDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<UploadTicketResponseDto> {
    return this.tickets.issue(dto, actor);
  }

  @Put('upload')
  @Public()
  @Roles(Role.PUBLIC)
  @SkipCsrf()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ResponseMessage('Upload completed successfully')
  @ApiOperation({ summary: 'Redeem an upload ticket by streaming the bytes (§3.5 step 2)' })
  @ApiHeader({
    name: UPLOAD_TICKET_HEADER,
    required: true,
    description: 'The opaque, short-lived, HMAC-signed upload ticket (§3.5).',
  })
  @ApiConsumes('application/octet-stream', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: UploadResultResponseDto })
  @ApiStandardResponses({ auth: false, unprocessable: true })
  async redeemUploadTicket(
    @Headers(UPLOAD_TICKET_HEADER) ticket: string | undefined,
    @Req() request: Request,
    @CurrentUser() actor: ICurrentUser | undefined,
  ): Promise<UploadResultResponseDto> {
    return this.uploads.redeem(ticket, request, actor);
  }
}
