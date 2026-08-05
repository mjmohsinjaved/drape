import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import {
  AbuseOverviewResponseDto,
  AbuseQueryDto,
  CreateIpBlockDto,
  IpBlockParamDto,
  IpBlockResponseDto,
} from '../dto/abuse.dto';
import { AbuseService } from '../services/abuse.service';

/**
 * The A-35 abuse view — ARCHITECTURE §5.17.
 *
 * **Every handler is `@Roles(Role.ADMIN)`.** Nothing here can identify a consumer
 * beyond her `userId`: `auth_attempts` stores an `emailHash` rather than an address
 * precisely so that a screen like this one cannot leak addresses (§4.7, E-12), and the
 * aggregates it reads carry no photograph, no render and no shortlist.
 *
 * ### Suspension is not here
 *
 * A-35 says "manual suspension and device or IP blocking". The suspension half is
 * A-19's `POST /admin/consumers/:userId/suspend` in `users`, which already takes the
 * required reason and revokes her live sessions; duplicating it here would be a second
 * way to suspend an account, with a second audit action, that could drift from the
 * first. What this controller adds is the half `users` cannot do: a block that applies
 * before there is a session to revoke.
 */
@ApiTags('Abuse')
@Controller('admin/abuse')
export class AdminAbuseController {
  constructor(private readonly abuse: AbuseService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Abuse overview retrieved successfully')
  @ApiOperation({
    summary: 'Accounts hitting rate limits or repeated failures (A-35)',
    description:
      'Grouped aggregates over `auth_attempts` (§4.7) and `tryon_jobs` (§4.17) inside a ' +
      'bounded window, each with a `HAVING` floor and a `LIMIT` — no unbounded read, and ' +
      'no row loaded that is not shown. Accounts are identified by id only.',
  })
  @ApiOkResponse({ type: AbuseOverviewResponseDto })
  @ApiStandardResponses()
  overview(@Query() query: AbuseQueryDto): Promise<AbuseOverviewResponseDto> {
    return this.abuse.overview(query);
  }

  @Get('ip-blocks')
  @Roles(Role.ADMIN)
  @ResponseMessage('IP blocks retrieved successfully')
  @ApiOperation({
    summary: 'Current IP blocks (§5.17)',
    description:
      'Expired blocks are returned with `active: false` rather than hidden — an operator ' +
      'lifting a block needs to see that it already lifted itself.',
  })
  @ApiOkResponse({ type: [IpBlockResponseDto] })
  @ApiStandardResponses()
  listBlocks(): Promise<IpBlockResponseDto[]> {
    return this.abuse.listBlocks();
  }

  @Post('ip-blocks')
  @Roles(Role.ADMIN)
  @ResponseMessage('IP block created')
  @ApiOperation({
    summary: 'Block an IP or CIDR (A-35)',
    description:
      'A reason is required: a block nobody can explain is a block nobody can safely ' +
      'lift. `expiresAt` is optional — null means indefinite (§4.8). Audit-logged as ' +
      '`IP_BLOCK_CREATED` (A-3).',
  })
  @ApiOkResponse({ type: IpBlockResponseDto })
  @ApiStandardResponses({ conflict: true })
  createBlock(
    @CurrentUser() admin: ICurrentUser,
    @Body() dto: CreateIpBlockDto,
  ): Promise<IpBlockResponseDto> {
    return this.abuse.createBlock(admin, dto);
  }

  @Delete('ip-blocks/:blockId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('IP block lifted')
  @ApiOperation({
    summary: 'Lift a block (§5.17)',
    description:
      'A soft delete: `UQ_ip_blocks_cidr` carries `WHERE "deletedAt" IS NULL`, so the ' +
      'range can be blocked again later while the record of who blocked it, and why, ' +
      'survives. Audit-logged as `IP_BLOCK_REMOVED`.',
  })
  @ApiNoContentResponse()
  @ApiStandardResponses({ notFound: true })
  removeBlock(@CurrentUser() admin: ICurrentUser, @Param() params: IpBlockParamDto): Promise<void> {
    return this.abuse.removeBlock(admin, params.blockId);
  }
}
