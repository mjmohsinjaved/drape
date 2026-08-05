import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CategoriesModule } from '@api/modules/categories';
import { SettingsModule } from '@api/modules/settings';

import { GarmentsController } from './controllers/garments.controller';
import { GarmentImage } from './entities/garment-image.entity';
import { Garment } from './entities/garment.entity';
import { GarmentsService } from './services/garments.service';

/**
 * A-8 … A-15 / §5.6 — the garment record.
 *
 * Owns `garments` and `garment_images` (§4.33).
 *
 * Why it imports what it imports:
 *  - **`CategoriesModule`** — a garment is filed under a category, and publishing it
 *    moves that category's `publishedGarmentCount` inside the publish transaction so
 *    the A-7 delete guard can never disagree with the catalogue.
 *  - **`SettingsModule`** — `quality.minScore` for the A-10 publish gate, read
 *    through the cached getter rather than from the `settings` table (§4.28).
 *
 * What it exports:
 *  - **`GarmentsService`** — the record surface other admin modules build on.
 *  - **`TypeOrmModule`** — so `catalog`, which owns no entities of its own (§4.33)
 *    and exists purely as the public read-only projection of this module, can read
 *    `garments` and `garment_images` without registering them a second time.
 *
 * `StorageModule` and `ConfigModule` are `@Global()` in the composition root, so
 * neither is imported here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Garment, GarmentImage]), CategoriesModule, SettingsModule],
  controllers: [GarmentsController],
  providers: [GarmentsService],
  exports: [GarmentsService, TypeOrmModule],
})
export class GarmentsModule {}
