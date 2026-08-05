import {
  Body,
  Controller,
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

import { AdminUserQueryDto } from '../dto/admin-user-query.dto';
import { AdminUserResponseDto } from '../dto/admin-user-response.dto';
import { ChangeUserRoleDto } from '../dto/change-user-role.dto';
import { UserIdParamDto } from '../dto/user-id-param.dto';
import { AdminUsersService } from '../services/admin-users.service';

/**
 * Admin account management — ARCHITECTURE §5.2, PRD A-2.
 *
 * **Every handler is `@Roles(Role.ADMIN)`** and every one of them carries an
 * authorisation test asserting a consumer session is refused (S-11, E-7) —
 * `admin-users.controller.spec.ts` walks this class's route table rather than
 * naming the handlers, so a route added later without a contract fails the suite as
 * well as `check:guards`.
 *
 * Controllers validate and delegate (§2.9 rule 1). There is no repository access
 * and no branching on business state below this line.
 */
@ApiTags('Admin · Users')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Admins retrieved successfully')
  @ApiOperation({ summary: 'List admin accounts (A-2)' })
  @ApiOkResponse({ type: [AdminUserResponseDto] })
  @ApiStandardResponses()
  list(@Query() query: AdminUserQueryDto): Promise<IPaginated<AdminUserResponseDto>> {
    return this.adminUsers.list(query);
  }

  @Get(':userId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Admin retrieved successfully')
  @ApiOperation({ summary: 'One admin account' })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiStandardResponses({ notFound: true })
  findOne(@Param() params: UserIdParamDto): Promise<AdminUserResponseDto> {
    return this.adminUsers.findOne(params.userId);
  }

  @Patch(':userId/role')
  @Roles(Role.ADMIN)
  @ResponseMessage('Role updated successfully')
  @ApiOperation({
    summary: 'Change role. Rejects self-change and the last active admin (A-2).',
    description:
      'Demotion only. An admin account can be created solely by the deployment seed or by ' +
      'accepting an invitation (S-5), so this endpoint cannot promote anyone.',
  })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  changeRole(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: UserIdParamDto,
    @Body() dto: ChangeUserRoleDto,
  ): Promise<AdminUserResponseDto> {
    return this.adminUsers.changeRole(actor, params.userId, dto);
  }

  @Post(':userId/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ResponseMessage('Account deactivated')
  @ApiOperation({ summary: 'Deactivate; revokes live sessions immediately (A-2)' })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  deactivate(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: UserIdParamDto,
  ): Promise<AdminUserResponseDto> {
    return this.adminUsers.deactivate(actor, params.userId);
  }

  @Post(':userId/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ResponseMessage('Account reactivated')
  @ApiOperation({ summary: 'Reactivate a deactivated admin' })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  reactivate(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: UserIdParamDto,
  ): Promise<AdminUserResponseDto> {
    return this.adminUsers.reactivate(actor, params.userId);
  }
}
