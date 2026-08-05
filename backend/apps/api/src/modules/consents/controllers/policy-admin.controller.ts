import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { CreatePolicyVersionDto } from '../dto/create-policy-version.dto';
import { PolicyVersionResponseDto } from '../dto/policy-response.dto';
import { PolicyService } from '../services/policy.service';

/**
 * ARCHITECTURE §5.4 — `GET /settings/policy` and `POST /settings/policy`.
 *
 * The routes live under `/settings` because that is where the admin experience puts
 * them, but `policy_versions` belongs to the `consents` module (§4.33), and the code
 * that publishes a version is the code that gates on it. Putting the controller here
 * keeps that single owner: `settings` never has to import this module, and the
 * re-consent rule stays in one place.
 */
@ApiTags('Consents')
@Controller('settings/policy')
export class PolicyAdminController {
  constructor(private readonly policies: PolicyService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Policy retrieved successfully')
  @ApiOperation({ summary: 'The current policy version and body, both translations' })
  @ApiOkResponse({ type: PolicyVersionResponseDto })
  @ApiStandardResponses({ notFound: true })
  async getCurrent(): Promise<PolicyVersionResponseDto> {
    return this.policies.getCurrentForAdmin();
  }

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Policy version published successfully')
  @ApiOperation({
    summary: 'Publish a new policy version. Triggers re-consent for everyone (C-12)',
  })
  @ApiCreatedResponse({ type: PolicyVersionResponseDto })
  @ApiStandardResponses({ conflict: true })
  async publish(
    @Body() dto: CreatePolicyVersionDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<PolicyVersionResponseDto> {
    return this.policies.publish(dto, actor);
  }
}
