import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminCategoriesController } from './controllers/admin-categories.controller';
import { CategoriesController } from './controllers/categories.controller';
import { Category } from './entities/category.entity';
import { CategoriesService } from './services/categories.service';

/**
 * A-4 … A-7 / §5.5 — the catalog taxonomy.
 *
 * Owns the `categories` table (§4.33). Two things leave this module:
 *
 *  - **`CategoriesService`** — `garments` calls `requireOpenCategory()` when a piece
 *    is filed, and `applyPublishedGarmentDelta()` inside its publish transaction so
 *    the A-7 delete guard's counter and the `publishState` it describes commit
 *    together.
 *  - **`TypeOrmModule`** — re-exported so `catalog`, which owns no entities of its
 *    own (§4.33) and exists only to project this one and `garments` for public
 *    browse, can read `categories` without a second registration of the same entity.
 *
 * `StorageModule` and `ConfigModule` are both `@Global()` in the composition root, so
 * neither is imported here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Category])],
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService, TypeOrmModule],
})
export class CategoriesModule {}
