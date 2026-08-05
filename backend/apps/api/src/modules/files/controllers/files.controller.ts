import { Body, Controller, Get, Param, Post, Put, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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

import { CreateUploadTicketDto } from '../dto/create-upload-ticket.dto';
import { FileTokenParamDto, UploadTicketParamDto } from '../dto/file-token-param.dto';
import {
  UploadResultResponseDto,
  UploadTicketResponseDto,
} from '../dto/upload-ticket-response.dto';
import { FileDownloadService } from '../services/file-download.service';
import { FileUploadService } from '../services/file-upload.service';
import { UploadTicketService } from '../services/upload-ticket.service';

import type { Request, Response } from 'express';

/**
 * ARCHITECTURE §5.20 — `files`.
 *
 * Every byte in the system enters through `PUT /files/upload/:ticket` and leaves through
 * `GET /files/:token`. Nothing else serves a stored object: `STORAGE_ROOT` sits outside the
 * repository and is never behind a static file handler (§3.2 requirement 8).
 */
@ApiTags('Files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly downloads: FileDownloadService,
    private readonly tickets: UploadTicketService,
    private readonly uploads: FileUploadService,
  ) {}

  /**
   * §5.20 — `PUBLIC`, because public assets exist: the catalog grid, category covers and the
   * brand logo are read by signed-out visitors. A `sub`-scoped token is a different matter and
   * still requires a matching session — `SessionAuthGuard` populates `request.user` on a
   * `@Public()` route when a valid cookie is presented (§2.6), and the service compares it with
   * the token's subject.
   *
   * The throttle is deliberately well above the §5.22 global default: one catalog screen is two
   * dozen file reads (C-9), and a 100/minute ceiling would make browsing fail rather than make
   * anything safer. The bytes are already bounded by what is in storage.
   */
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

  /**
   * §5.20 / §3.5 step 2 — redeem a ticket by streaming the bytes.
   *
   * **`@SkipCsrf()`**: §5.20 marks this route ⊘ in the route table. The reason it is safe is
   * that the credential is in the URL, not in an ambient cookie — a cross-site form cannot
   * forge one, because it cannot obtain a ticket that our own API signed for that account and
   * that key. The route is also the one place where a future S3 driver takes the API out of the
   * data path entirely, and a bucket has no CSRF cookie to double-submit.
   *
   * `@Public()` for the same reason the ticket exists: the ticket is the credential. It is
   * still subject-scoped, so redeeming somebody else's ticket without their session fails with
   * `UPLOAD_TICKET_INVALID`.
   *
   * The handler takes the raw `Request` because it must not be parsed. Express' JSON and
   * urlencoded parsers do not match `image/*`, so the request arrives here as an unread stream
   * — which is exactly what "no buffering of the whole file" requires.
   */
  @Put('upload/:ticket')
  @Public()
  @Roles(Role.PUBLIC)
  @SkipCsrf()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ResponseMessage('Upload completed successfully')
  @ApiOperation({ summary: 'Redeem an upload ticket by streaming the bytes (§3.5 step 2)' })
  @ApiConsumes('application/octet-stream', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: UploadResultResponseDto })
  @ApiStandardResponses({ auth: false, unprocessable: true })
  async redeemUploadTicket(
    @Param() params: UploadTicketParamDto,
    @Req() request: Request,
    @CurrentUser() actor: ICurrentUser | undefined,
  ): Promise<UploadResultResponseDto> {
    return this.uploads.redeem(params.ticket, request, actor);
  }
}
