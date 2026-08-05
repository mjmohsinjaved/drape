/**
 * The `categories` module's public surface.
 *
 * `CategoriesService` is the one `garments` wants:
 *
 * ```typescript
 * const category = await this.categories.requireOpenCategory(dto.categoryId);
 * await this.categories.applyPublishedGarmentDelta(manager, category.id, +1);
 * ```
 *
 * Nothing else here is required by another module; the DTOs are exported so the
 * OpenAPI export and the `catalog` projection can name the same shapes.
 */
export { CategoriesModule } from './categories.module';
export { CategoriesService } from './services/categories.service';
export {
  AdminCategoryQueryDto,
  AdminCategoryResponseDto,
  PublicCategoryResponseDto,
} from './dto/category-response.dto';
export { CategoryIdParamDto } from './dto/category-id-param.dto';
export { CreateCategoryDto } from './dto/create-category.dto';
export { MAX_REORDER_BATCH, ReorderCategoriesDto } from './dto/reorder-categories.dto';
export { UpdateCategoryDto } from './dto/update-category.dto';
export {
  toAdminCategory,
  toPublicCategory,
  type CategoryNode,
  type SignUrl,
} from './mappers/category.mapper';
export { MAX_CATEGORY_SLUG_LENGTH, slugify, suffixedSlug } from './utils/slug.util';
