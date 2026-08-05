import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SettingsModule } from '@api/modules/settings';

import { GarmentImageController } from './controllers/garment-image.controller';
import { GarmentImagesController } from './controllers/garment-images.controller';
import { GarmentImage } from './entities/garment-image.entity';
import { Garment } from './entities/garment.entity';
import { GarmentImagesService } from './services/garment-images.service';
import { ImageQualityService } from './services/image-quality.service';

/**
 * PRD A-9, A-10 / ARCHITECTURE §5.7 — a garment's images and their quality verdict.
 *
 * A separate module from `GarmentsModule`, which owns the garment **record** (§5.6). They share
 * two tables and nothing else: the record module decides what a garment *is* and whether it may
 * be published; this one decides what its images are and what the A-10 validator says about the
 * try-on source. Splitting them keeps `sharp`, the storage service and the image pipeline out of
 * the module every other admin feature imports for `GarmentsService`.
 *
 * Both register `TypeOrmModule.forFeature([Garment, GarmentImage])`. That is not duplication:
 * `forFeature` binds repository providers into the importing module's injector, and the entities
 * themselves are registered once, by `DatabaseModule`.
 *
 * What it exports:
 *  - **`ImageQualityService`** — so the A-11 test-render flow (W3) can re-score a source without
 *    re-implementing the A-10 pass mark. The scoring itself is a pure function in
 *    `validators/image-quality.validator.ts` and needs no module at all.
 *
 * `StorageModule` (which provides `StorageService` and `ImageService`) and `EventEmitterModule`
 * are both global in the composition root, so neither is imported here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Garment, GarmentImage]), SettingsModule],
  controllers: [GarmentImagesController, GarmentImageController],
  providers: [GarmentImagesService, ImageQualityService],
  exports: [ImageQualityService],
})
export class GarmentImagesModule {}
