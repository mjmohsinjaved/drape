import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ApiStandardResponses,
  CurrentUser,
  Public,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { Locale } from '@api/modules/users/enums/locale.enum';

import { ConsentStatusResponseDto } from '../dto/consent-status-response.dto';
import { CreateConsentDto } from '../dto/create-consent.dto';
import { PolicyQueryDto } from '../dto/policy-query.dto';
import { PolicyResponseDto } from '../dto/policy-response.dto';
import { ConsentsService } from '../services/consents.service';
import { PolicyService } from '../services/policy.service';

import type { Request } from 'express';

/** `consents.userAgent` is `varchar(512)` (§4.11). */
const MAX_USER_AGENT_LENGTH = 512;

/**
 * ARCHITECTURE §5.10 — the C-11 consent gate.
 *
 * `GET /consents/policy` is public because the gate is the first thing a new consumer
 * meets: she has to be able to read what she is agreeing to. It is the only public
 * route in this module, it exposes text and nothing else, and it carries an explicit
 * `@Throttle()` per §2.6.
 */
@ApiTags('Consents')
@Controller('consents')
export class ConsentsController {
  constructor(
    private readonly consents: ConsentsService,
    private readonly policies: PolicyService,
  ) {}

  @Get('policy')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ResponseMessage('Policy retrieved successfully')
  @ApiOperation({ summary: 'The current policy version and body, in the requested locale (C-11)' })
  @ApiOkResponse({ type: PolicyResponseDto })
  @ApiStandardResponses({ auth: false, notFound: true })
  async getPolicy(
    @Query() query: PolicyQueryDto,
    @CurrentUser('locale') sessionLocale: Locale | undefined,
  ): Promise<PolicyResponseDto> {
    return this.policies.getCurrentForLocale(query.locale ?? sessionLocale ?? Locale.EN);
  }

  @Get('me')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Consent status retrieved successfully')
  @ApiOperation({ summary: 'Whether her consent is current at the current policy version (C-12)' })
  @ApiOkResponse({ type: ConsentStatusResponseDto })
  @ApiStandardResponses({ notFound: true })
  async getMine(@CurrentUser('id') userId: string): Promise<ConsentStatusResponseDto> {
    return this.consents.resolveStatus(userId);
  }

  @Post()
  @Roles(Role.CONSUMER)
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Consent recorded successfully')
  @ApiOperation({ summary: 'Record consent with timestamp, IP, user agent and version (C-12)' })
  @ApiCreatedResponse({ type: ConsentStatusResponseDto })
  @ApiStandardResponses({ conflict: true, notFound: true })
  async record(
    @CurrentUser() user: ICurrentUser,
    @Body() dto: CreateConsentDto,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<ConsentStatusResponseDto> {
    // C-12 wants the user agent as evidence of the device that agreed. It is read
    // here, at the edge, rather than passed through a DTO a client could forge.
    const userAgent = (request.headers['user-agent'] ?? '').slice(0, MAX_USER_AGENT_LENGTH);
    return this.consents.record(user, dto, { ip, userAgent });
  }
}
