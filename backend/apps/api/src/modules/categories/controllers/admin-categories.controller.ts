import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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

import { CategoryIdParamDto } from '../dto/category-id-param.dto';
import { AdminCategoryQueryDto, AdminCategoryResponseDto } from '../dto/category-response.dto';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { ReorderCategoriesDto } from '../dto/reorder-categories.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { CategoriesService } from '../services/categories.service';

/**
 * Taxonomy management — ARCHITECTURE §5.5, PRD A-4 … A-7.
 *
 * **Every handler is `@Roles(Role.ADMIN)`**, and the spec beside this file asserts a
 * consumer session and an anonymous caller are both refused on each one (S-11, E-7).
 *
 * The controller validates and delegates (§2.9 rule 1). Depth (A-5), the delete guard
 * (A-7) and the atomic renumbering all live in `CategoriesService`, because they are
 * decisions about data and none of them can be made from the request alone.
 */
@ApiTags('Categories')
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Categories retrieved successfully')
  @ApiOperation({ summary: 'Full tree including archived, with garment counts (§5.5)' })
  @ApiOkResponse({ type: [AdminCategoryResponseDto] })
  @ApiStandardResponses()
  findAll(@Query() query: AdminCategoryQueryDto): Promise<AdminCategoryResponseDto[]> {
    return this.categories.findAdminTree(query);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ResponseMessage('Category created successfully')
  @ApiOperation({ summary: 'Create a category or a one-level sub-category (A-4, A-5)' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<AdminCategoryResponseDto> {
    return this.categories.create(dto, actor);
  }

  /**
   * Declared before `:categoryId` routes so that `reorder` is matched as a literal
   * path segment rather than swallowed as a category id.
   */
  @Post('reorder')
  @Roles(Role.ADMIN)
  @ResponseMessage('Categories reordered successfully')
  @ApiOperation({
    summary: 'Persist a new sort order for a sibling set (A-4, A-6)',
    description:
      'Send the complete sibling set in display order. Positions are renumbered 0…n-1 ' +
      'inside one transaction; a partial set is refused.',
  })
  @ApiOkResponse({ type: [AdminCategoryResponseDto] })
  @ApiStandardResponses({ notFound: true, conflict: true })
  reorder(
    @Body() dto: ReorderCategoriesDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<AdminCategoryResponseDto[]> {
    return this.categories.reorder(dto, actor);
  }

  @Patch(':categoryId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Category updated successfully')
  @ApiOperation({ summary: 'Rename, re-parent or set the cover image (A-5, A-6)' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  update(
    @Param() params: CategoryIdParamDto,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<AdminCategoryResponseDto> {
    return this.categories.update(params.categoryId, dto, actor);
  }

  @Post(':categoryId/archive')
  @Roles(Role.ADMIN)
  @ResponseMessage('Category archived successfully')
  @ApiOperation({ summary: 'Archive — the only way out for a category holding pieces (A-7)' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  archive(
    @Param() params: CategoryIdParamDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<AdminCategoryResponseDto> {
    return this.categories.archive(params.categoryId, actor);
  }

  @Post(':categoryId/restore')
  @Roles(Role.ADMIN)
  @ResponseMessage('Category restored successfully')
  @ApiOperation({ summary: 'Un-archive (§5.5)' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  restore(
    @Param() params: CategoryIdParamDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<AdminCategoryResponseDto> {
    return this.categories.restore(params.categoryId, actor);
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  @ResponseMessage('Category deleted successfully')
  @ApiOperation({
    summary: 'Delete. Blocked while it holds published pieces (A-7)',
    description:
      'Refused with CATEGORY_HAS_PUBLISHED_GARMENTS when the category or any of its ' +
      'sub-categories still holds a published garment. Archive it instead.',
  })
  @ApiNoContentResponse()
  @ApiStandardResponses({ notFound: true, conflict: true })
  remove(@Param() params: CategoryIdParamDto, @CurrentUser() actor: ICurrentUser): Promise<void> {
    return this.categories.remove(params.categoryId, actor);
  }
}
