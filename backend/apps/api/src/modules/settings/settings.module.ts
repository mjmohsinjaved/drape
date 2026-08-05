import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SettingsController } from './controllers/settings.controller';
import { Setting } from './entities/setting.entity';
import { BrandSettingsService } from './services/brand-settings.service';
import { PreviewModeService } from './services/preview-mode.service';
import { SettingsService } from './services/settings.service';
import { ShortLinkService } from './services/short-link.service';

/**
 * A-27 … A-32 / §5.4 — platform settings.
 *
 * Owns the `settings` table (§4.33). What it exports is what the rest of the product
 * leans on:
 *
 *  - **`SettingsService`** — the cached, typed getter. Every module in W3–W7 reads
 *    quota defaults, budget thresholds and the A-30 toggles through it, on the hot
 *    path, without touching the database.
 *  - **`PreviewModeService`** — A-31. `TryOnModule` asks `isPreviewActive(adminId)`
 *    before it spends a generation.
 *
 * `BrandSettingsService` and `ShortLinkService` stay internal: they exist to serve
 * this module's own routes, and nothing outside needs to sign a logo URL or draw a QR.
 *
 * `StorageModule` and `ConfigModule` are both `@Global()` in the composition root, so
 * neither is imported here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  controllers: [SettingsController],
  providers: [SettingsService, BrandSettingsService, ShortLinkService, PreviewModeService],
  exports: [SettingsService, PreviewModeService],
})
export class SettingsModule {}
