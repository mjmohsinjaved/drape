import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardResponses, ResponseMessage, Role, Roles } from '@library/common';

import { CatalogHealthQueryDto, CatalogHealthResponseDto } from '../dto/catalog-health.dto';
import { CatalogHealthService } from '../services/catalog-health.service';

/**
 * `GET /admin/catalog-health` — PRD A-15, ARCHITECTURE §5.6.
 *
 * Its own controller rather than another handler on `GarmentsController`, because the
 * path is its own: §5.6 puts it at `/admin/catalog-health`, not under
 * `/admin/garments`, and a `@Controller('admin/garments')` cannot serve it without
 * either a `../` in the route string or a second prefix on the class.
 *
 * `@Roles(Role.ADMIN)`, like everything else in this module. The panel names draft
 * pieces, quality scores and failure counts — none of which a consumer has any route
 * to, here or anywhere.
 *
 * **No audit row.** A-3 lists what the log must cover — catalog *changes*, publishes,
 * deletions, role changes, quota changes, suspensions, moderation-queue views and
 * settings changes. This route changes nothing and reads no personal data (contrast
 * `MODERATION_QUEUE_VIEWED`, which is audited precisely because the queue is made of
 * consumer photographs). Auditing a read of aggregate catalogue counts would add noise
 * to the one log an admin has to be able to scan.
 */
@ApiTags('Garments')
@Controller('admin/catalog-health')
export class CatalogHealthController {
  constructor(private readonly health: CatalogHealthService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Catalog health retrieved successfully')
  @ApiOperation({
    summary:
      'Garments missing an approved test render, low quality scores, elevated ' +
      'generation-failure rates, and zero try-ons in 30 days (A-15)',
    description:
      'Each cohort carries a **true total**, aggregated in SQL over the whole ' +
      'catalogue, plus a bounded sample ordered worst-first so every row is one click ' +
      'from its remedy. Archived pieces are out of scope: they were retired on ' +
      'purpose (A-13).',
  })
  @ApiOkResponse({ type: CatalogHealthResponseDto })
  @ApiStandardResponses()
  find(@Query() query: CatalogHealthQueryDto): Promise<CatalogHealthResponseDto> {
    return this.health.health(query);
  }
}
