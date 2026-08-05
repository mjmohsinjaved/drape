import { Module } from '@nestjs/common';

import { CategoriesModule } from '@api/modules/categories';
import { GarmentsModule } from '@api/modules/garments';
import { SettingsModule } from '@api/modules/settings';

import { CatalogController } from './controllers/catalog.controller';
import { CatalogService } from './services/catalog.service';

/**
 * C-1, C-8, C-17, C-18 / §5.8 — the public browse projection.
 *
 * **Owns no entities** (§4.33). It is read-only by construction: there is no
 * repository write in the module, no `@Roles(Role.ADMIN)` route, and no mutation
 * method on `CatalogService`.
 *
 * It reads `garments`, `garment_images` and `categories` through the repositories
 * `GarmentsModule` and `CategoriesModule` re-export. §2.9 rule 5 says a module
 * imports another module rather than its entity file, and that is what happens here —
 * the entity *classes* appear only as TypeORM injection tokens and as types, and
 * every rule about those tables still lives in the module that owns them. A projection
 * has to read something; what it must not do is decide anything, and it does not.
 *
 * `SettingsModule` supplies `catalog.showPricesPublicly` (A-30) through the cached
 * getter. `StorageModule` is `@Global()`, so signing an image URL needs no import.
 */
@Module({
  imports: [GarmentsModule, CategoriesModule, SettingsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
