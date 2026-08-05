import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiStandardResponses, Public, ResponseMessage, Role, Roles } from '@library/common';

import { PublicCategoryResponseDto } from '../dto/category-response.dto';
import { CategoriesService } from '../services/categories.service';

/**
 * `GET /categories` — the public browse taxonomy (ARCHITECTURE §5.5, PRD C-1).
 *
 * > "Browsing is public. Catalog, categories, search, filters and garment detail are
 * > reachable while signed out."
 *
 * So this route is `@Public()`, and — per §2.6 — it still declares
 * `@Roles(Role.PUBLIC)` and an explicit `@Throttle()`. `@Public()` bypasses
 * `SessionAuthGuard` and nothing else: CSRF and the throttler still run.
 *
 * The limit mirrors the §5.22 global default rather than inventing a policy for one
 * route; it is written out so that a later change to the global default cannot
 * silently loosen or tighten an unauthenticated endpoint.
 */
@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ResponseMessage('Categories retrieved successfully')
  @ApiOperation({
    summary: 'The published, non-archived category tree in sort order (A-6, C-1)',
    description:
      'One level of sub-categories (A-5). Archived categories, and any sub-category of ' +
      'an archived category, are absent. Carries no garment counts and no storage keys.',
  })
  @ApiOkResponse({ type: [PublicCategoryResponseDto] })
  @ApiStandardResponses({ auth: false })
  findAll(): Promise<PublicCategoryResponseDto[]> {
    return this.categories.findPublicTree();
  }
}
