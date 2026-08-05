import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, In, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  NotFoundException,
  ValidationException,
  type ICurrentUser,
} from '@library/common';
import { runInTransaction } from '@library/database';
import { ImageService, StorageKeys, StoragePrefixes, StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { GarmentImage } from '../entities/garment-image.entity';
import { Garment } from '../entities/garment.entity';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';
import {
  toGarmentImageResponse,
  toGarmentImageWithQuality,
  toImageQualityReport,
} from '../mappers/garment-image.mapper';

import { ImageQualityService } from './image-quality.service';

import type { GarmentImageBatchResponseDto } from '../dto/garment-image-batch.dto';
import type {
  CreateGarmentImageDto,
  ReorderGarmentImagesDto,
  UpdateGarmentImageDto,
} from '../dto/garment-image-create.dto';
import type {
  GarmentImageResponseDto,
  GarmentImageWithQualityResponseDto,
} from '../dto/garment-image-response.dto';
import type { ImageQualityReportDto } from '../dto/image-quality-response.dto';

/** §3.3 — the grid thumbnail width. Generated on write, never on read (§3.6). */
const GALLERY_THUMBNAIL_WIDTH = 320;

/**
 * PRD A-9 / ARCHITECTURE §5.7 — the images of a garment.
 *
 * ### The one invariant this class exists to hold
 *
 * **Exactly one image per garment is the try-on source.** It is the file sent upstream as
 * `garment_image`, it is half of the §3.7 cache key, and a published garment without one breaks
 * the consumer try-on path outright. Three things enforce it, deliberately overlapping:
 *
 *  1. a **partial unique index** — `UQ_garment_images_source UNIQUE ("garmentId") WHERE
 *     "isTryOnSource" = true AND "deletedAt" IS NULL` (§4.14). The database refuses a second
 *     source no matter which process asks;
 *  2. **one transaction** for the demote-then-promote pair, so two admins racing to designate
 *     different images serialise on that index instead of interleaving. The loser's transaction
 *     fails on the constraint rather than leaving a garment with two sources or none;
 *  3. **adding an image never silently demotes the current source** — `create()` refuses with
 *     `TRYON_SOURCE_ALREADY_SET`. Replacing the source is a deliberate act with its own
 *     endpoint and its own audit row.
 *
 * ### Deleting the try-on source of a published garment
 *
 * **Refused**, with `TRYON_SOURCE_REQUIRED`. The alternative — silently unpublishing — takes a
 * live piece off the consumer catalogue as a side effect of an image edit, which is exactly what
 * D-17 forbids ("destructive actions require confirmation naming the affected item"). It would
 * also give the publish state machine (§4.13) a transition out of `PUBLISHED` that no audit
 * action describes and no admin asked for. The refusal names the two ways forward — unpublish
 * the piece, or designate a different source first — and both are one click away.
 *
 * A draft or archived garment has no such problem: its source can be deleted, and the garment's
 * quality verdict and test-render approval are cleared with it, because both described a file
 * that no longer exists.
 */
@Injectable()
export class GarmentImagesService {
  private readonly logger = new Logger(GarmentImagesService.name);

  constructor(
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(GarmentImage)
    private readonly images: Repository<GarmentImage>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly imageProcessor: ImageService,
    private readonly quality: ImageQualityService,
    private readonly events: EventEmitter2,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Reads
   * -------------------------------------------------------------------------------------- */

  /** `GET /admin/garments/:garmentId/images` — gallery order (§5.7). */
  async findAll(garmentId: string): Promise<GarmentImageResponseDto[]> {
    await this.requireGarment(garmentId);
    const rows = await this.images.find({
      where: { garmentId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => this.present(row));
  }

  /**
   * `POST /admin/garment-images/batch` — the primary image of many garments at once
   * (§5.7, §6.2).
   *
   * ### Why it exists
   *
   * §6.2 asks the admin catalog table for a 40 px thumbnail on every row. `GET
   * /admin/garments` does not carry one — `GarmentResponseDto` has no image field, and
   * adding one would put a join and a signing call on the hot list query whether the
   * caller wants pictures or not. The alternative the console was left with is one
   * `GET /admin/garments/:id/images` per row: a hundred requests to draw one screen.
   *
   * ### What "primary" means
   *
   * The **try-on source** where there is one, because that is the image the piece is
   * actually judged and generated from (A-9), and the first image in gallery order
   * otherwise. One query for every garment asked about, not one per garment.
   *
   * ### The URLs are scoped to the caller
   *
   * `signedUrl(key, admin.id)` — the token carries `sub`, so `GET /files/:token`
   * additionally requires a session belonging to that admin (§3.4 step 4). §3.4's table
   * leaves `sub` off `garments/**` because those objects are also served to the public
   * catalogue; this route is not that route. It is an admin console read, and a token
   * minted here that another account could replay would be a token worth stealing. The
   * public projection in `modules/catalog` is unaffected and still issues the unscoped,
   * cacheable form.
   *
   * A garment id that names nothing comes back with `image: null`, exactly like a
   * garment with no images. This is a table-rendering aid, not a lookup: it reveals no
   * more than `GET /admin/garments` already does to the same admin, and refusing the
   * whole batch because one row was deleted a second ago would break the screen for
   * everything else on it.
   */
  async findPrimaryForGarments(
    garmentIds: readonly string[],
    actor: ICurrentUser,
  ): Promise<GarmentImageBatchResponseDto> {
    // An empty `IN ()` is not valid SQL and an empty request is not an error.
    if (garmentIds.length === 0) {
      return { items: [] };
    }

    const rows = await this.images.find({
      where: { garmentId: In([...garmentIds]) },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const primary = new Map<string, GarmentImage>();
    for (const row of rows) {
      const current = primary.get(row.garmentId);
      // The try-on source always wins; otherwise the first row of an already-ordered
      // result set is the first image in gallery order.
      if (current === undefined || (row.isTryOnSource && !current.isTryOnSource)) {
        primary.set(row.garmentId, row);
      }
    }

    return {
      items: garmentIds.map((garmentId) => {
        const image = primary.get(garmentId);
        return {
          garmentId,
          image: image === undefined ? null : this.presentFor(image, actor.id),
        };
      }),
    };
  }

  /* -----------------------------------------------------------------------------------------
   * Writes
   * -------------------------------------------------------------------------------------- */

  /**
   * `POST /admin/garments/:garmentId/images` — finalise an uploaded image (§5.7, §3.5 step 3).
   *
   * Nothing the client said about the file is trusted. The key must name an object that exists
   * under **this** garment's prefix; the dimensions, byte size, MIME type and sha256 are read
   * from the stored bytes; the thumbnail is generated here rather than on read (§3.6).
   */
  async create(
    garmentId: string,
    dto: CreateGarmentImageDto,
    actor: ICurrentUser,
  ): Promise<GarmentImageWithQualityResponseDto | GarmentImageResponseDto> {
    const garment = await this.requireGarment(garmentId);
    const wantsTryOnSource = dto.isTryOnSource === true;

    if (wantsTryOnSource && (await this.findTryOnSource(garmentId)) !== null) {
      throw new ConflictException(ErrorCode.TRYON_SOURCE_ALREADY_SET, {
        message:
          'This piece already has a try-on source. Add the image, then set it as the try-on ' +
          'source to replace the current one.',
      });
    }

    const stored = await this.requireStoredObject(garmentId, dto.key);
    const buffer = await this.storage.getBuffer(dto.key);
    const metadata = await this.imageProcessor.metadata(buffer);

    // A-10 runs before anything is written, so a garment never carries a row for an image whose
    // score was never computed.
    const report = wantsTryOnSource ? await this.quality.evaluate(buffer) : null;
    const thumbnailKey = await this.writeThumbnail(buffer);

    const row = this.images.create({
      garmentId,
      storageKey: dto.key,
      thumbnailKey,
      isTryOnSource: wantsTryOnSource,
      hash: stored.etag,
      width: metadata.width,
      height: metadata.height,
      byteSize: stored.byteSize,
      mimeType: stored.contentType,
      position: dto.position ?? (await this.nextPosition(garmentId)),
      altText: dto.altText ?? null,
    });

    const saved = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<GarmentImage> => {
        const inserted = await manager.getRepository(GarmentImage).save(row);
        if (report !== null) {
          await this.writeQualityToGarment(manager, garment, report);
        }
        return inserted;
      },
      { label: 'garment-images.create' },
    );

    this.emitImageAudit(AUDIT_ACTIONS.GARMENT_IMAGE_ADDED, garment, saved, actor, {
      isTryOnSource: wantsTryOnSource,
    });
    if (report !== null) {
      this.emitImageAudit(AUDIT_ACTIONS.GARMENT_TRYON_SOURCE_SET, garment, saved, actor, {
        qualityScore: report.score,
        needsBetterPhoto: !report.passed,
      });
    }

    return report === null
      ? this.present(saved)
      : toGarmentImageWithQuality(saved, report, (key) => this.storage.signedUrl(key));
  }

  /** `PATCH /admin/garment-images/:imageId` — alt text and position (§5.7). */
  async update(
    imageId: string,
    dto: UpdateGarmentImageDto,
    actor: ICurrentUser,
  ): Promise<GarmentImageResponseDto> {
    const image = await this.requireImage(imageId);
    const positionChanged = dto.position !== undefined && dto.position !== image.position;

    if (dto.altText !== undefined) {
      image.altText = dto.altText;
    }
    if (dto.position !== undefined) {
      image.position = dto.position;
    }

    const saved = await this.images.save(image);

    if (positionChanged) {
      const garment = await this.requireGarment(image.garmentId);
      this.emitImageAudit(AUDIT_ACTIONS.GARMENT_IMAGE_REORDERED, garment, saved, actor, {
        position: saved.position,
      });
    }

    return this.present(saved);
  }

  /**
   * `POST /admin/garment-images/:imageId/tryon-source` — designate the try-on source (§5.7, A-9).
   *
   * "Clears the previous one and resets `testRenderState` to `NONE`." Both happen inside one
   * transaction, in that order, so the partial unique index never sees two live sources — and
   * the reset is not optional: an approved test render is evidence about a *particular* file
   * (A-11), and pointing the garment at a different one makes that evidence stale.
   */
  async setTryOnSource(
    imageId: string,
    actor: ICurrentUser,
  ): Promise<GarmentImageWithQualityResponseDto> {
    const image = await this.requireImage(imageId);
    const garment = await this.requireGarment(image.garmentId);

    const buffer = await this.storage.getBuffer(image.storageKey);
    const report = await this.quality.evaluate(buffer);

    const saved = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<GarmentImage> => {
        const repository = manager.getRepository(GarmentImage);

        // Demote first. The partial unique index (§4.14) means a concurrent designation of a
        // different image cannot slip between these two statements: whichever transaction
        // commits second fails on the constraint rather than producing a second source.
        await repository.update(
          { garmentId: image.garmentId, isTryOnSource: true },
          { isTryOnSource: false },
        );
        await repository.update({ id: image.id }, { isTryOnSource: true });

        await this.writeQualityToGarment(manager, garment, report);

        const promoted = await repository.findOne({ where: { id: image.id } });
        return promoted ?? Object.assign(image, { isTryOnSource: true });
      },
      { label: 'garment-images.set-tryon-source' },
    );

    this.emitImageAudit(AUDIT_ACTIONS.GARMENT_TRYON_SOURCE_SET, garment, saved, actor, {
      qualityScore: report.score,
      needsBetterPhoto: !report.passed,
    });

    return toGarmentImageWithQuality(saved, report, (key) => this.storage.signedUrl(key));
  }

  /**
   * `POST /admin/garments/:garmentId/images/reorder` — persist gallery order (§5.7).
   *
   * The submitted list must be exactly the garment's images. A list missing one would leave it
   * at a position that collides with a reordered sibling, and a list naming an image from
   * another garment is either a bug or an attempt to reach across a boundary.
   */
  async reorder(
    garmentId: string,
    dto: ReorderGarmentImagesDto,
    actor: ICurrentUser,
  ): Promise<GarmentImageResponseDto[]> {
    const garment = await this.requireGarment(garmentId);
    const current = await this.images.find({ where: { garmentId } });

    this.assertCoversEveryImage(current, dto.imageIds);

    await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<void> => {
        const repository = manager.getRepository(GarmentImage);
        for (const [position, imageId] of dto.imageIds.entries()) {
          await repository.update({ id: imageId, garmentId }, { position });
        }
      },
      { label: 'garment-images.reorder' },
    );

    this.emitAudit(AUDIT_ACTIONS.GARMENT_IMAGE_REORDERED, garment, actor, {
      imageCount: dto.imageIds.length,
    });

    return this.findAll(garmentId);
  }

  /**
   * `DELETE /admin/garment-images/:imageId` — remove an image and its file (§5.7).
   *
   * See the class comment for why deleting the try-on source of a **published** garment is
   * refused rather than silently unpublishing it.
   */
  async remove(imageId: string, actor: ICurrentUser): Promise<void> {
    const image = await this.requireImage(imageId);
    const garment = await this.requireGarment(image.garmentId);

    if (image.isTryOnSource && garment.publishState === PublishState.PUBLISHED) {
      throw new ConflictException(ErrorCode.TRYON_SOURCE_REQUIRED, {
        message:
          'This is the try-on source of a published piece. Unpublish the piece, or set another ' +
          'image as its try-on source, then remove this one.',
        details: { garmentId: garment.id, publishState: garment.publishState },
      });
    }

    await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<void> => {
        await manager.getRepository(GarmentImage).softDelete({ id: image.id });

        if (image.isTryOnSource) {
          // The score and the approved render both described this file. Neither survives it.
          await manager.getRepository(Garment).update(
            { id: garment.id },
            {
              qualityScore: null,
              qualityChecks: null,
              testRenderState: TestRenderState.NONE,
              testRenderId: null,
              testRenderApprovedAt: null,
              approvedBy: null,
            },
          );
        }
      },
      { label: 'garment-images.remove' },
    );

    // Best effort, after the commit. An orphaned object is swept by the retention cron; a row
    // deleted only because a file delete happened to succeed would be far worse.
    await this.deleteObjects(image);

    this.emitImageAudit(AUDIT_ACTIONS.GARMENT_IMAGE_REMOVED, garment, image, actor, {
      wasTryOnSource: image.isTryOnSource,
    });
  }

  /**
   * `POST /admin/garment-images/:imageId/revalidate` — re-run the A-10 validator (§5.7).
   *
   * Useful after `quality.minScore` moves, or after the thresholds change in a release: the
   * stored verdict is a judgement made at a point in time, and an admin should be able to ask
   * for it again without re-uploading the photograph.
   */
  async revalidate(imageId: string, actor: ICurrentUser): Promise<ImageQualityReportDto> {
    const image = await this.requireImage(imageId);
    const garment = await this.requireGarment(image.garmentId);

    const buffer = await this.storage.getBuffer(image.storageKey);
    const report = await this.quality.evaluate(buffer);

    if (image.isTryOnSource) {
      const columns = this.quality.toGarmentColumns(report);
      await this.garments.update({ id: garment.id }, columns);
      this.emitAudit(AUDIT_ACTIONS.GARMENT_UPDATED, garment, actor, {
        qualityScore: report.score,
        needsBetterPhoto: !report.passed,
        revalidated: true,
      });
    }

    return toImageQualityReport(report);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async requireGarment(garmentId: string): Promise<Garment> {
    const garment = await this.garments.findOne({ where: { id: garmentId } });
    if (garment === null) {
      throw new NotFoundException(ErrorCode.GARMENT_NOT_FOUND);
    }
    return garment;
  }

  private async requireImage(imageId: string): Promise<GarmentImage> {
    const image = await this.images.findOne({ where: { id: imageId } });
    if (image === null) {
      // §2.4 has no GARMENT_IMAGE_NOT_FOUND; the generic code is correct and reveals nothing
      // about whether the id exists under a garment the caller cannot see.
      throw new NotFoundException(ErrorCode.RESOURCE_NOT_FOUND);
    }
    return image;
  }

  private async findTryOnSource(garmentId: string): Promise<GarmentImage | null> {
    return this.images.findOne({ where: { garmentId, isTryOnSource: true } });
  }

  /**
   * The key must name a real object under **this** garment's prefix.
   *
   * The prefix check is what stops a finalise call pointing a garment row at somebody's person
   * photo or at another garment's image: the ticket that produced the key was already scoped, so
   * a key from a different prefix means the client is not using a key it was given.
   */
  private async requireStoredObject(
    garmentId: string,
    key: string,
  ): Promise<{ etag: string; byteSize: number; contentType: string }> {
    if (!key.startsWith(StoragePrefixes.garment(garmentId))) {
      throw new ValidationException(ErrorCode.STORAGE_PATH_REJECTED, {
        message: 'That upload does not belong to this piece. Start the upload again.',
      });
    }

    const stored = await this.storage.head(key);
    if (stored === null) {
      throw new NotFoundException(ErrorCode.FILE_NOT_FOUND);
    }
    return stored;
  }

  /** §3.6 — thumbnails are generated on write, never on read. */
  private async writeThumbnail(buffer: Buffer): Promise<string | null> {
    try {
      const thumbnail = await this.imageProcessor.toWebpThumbnail(buffer, GALLERY_THUMBNAIL_WIDTH, {
        fit: 'inside',
      });
      const key = StorageKeys.thumbnail('garment', GALLERY_THUMBNAIL_WIDTH);
      await this.storage.put(key, thumbnail, { contentType: 'image/webp' });
      return key;
    } catch {
      // A missing thumbnail costs the admin table a little bandwidth. A failed upload because
      // the thumbnail encoder tripped costs them the image.
      this.logger.warn('Could not generate a gallery thumbnail; the full-size image was kept.');
      return null;
    }
  }

  private async nextPosition(garmentId: string): Promise<number> {
    return this.images.count({ where: { garmentId } });
  }

  /** A-10 — the score and the per-check verdict land on the garment, inside the caller's transaction. */
  private async writeQualityToGarment(
    manager: EntityManager,
    garment: Garment,
    report: Parameters<ImageQualityService['toGarmentColumns']>[0],
  ): Promise<void> {
    await manager.getRepository(Garment).update(
      { id: garment.id },
      {
        ...this.quality.toGarmentColumns(report),
        // A-11: the approved render described the previous source file.
        testRenderState: TestRenderState.NONE,
        testRenderId: null,
        testRenderApprovedAt: null,
        approvedBy: null,
      },
    );
  }

  private assertCoversEveryImage(current: readonly GarmentImage[], submitted: string[]): void {
    const existing = new Set(current.map((image) => image.id));
    const same = existing.size === submitted.length && submitted.every((id) => existing.has(id));

    if (!same) {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        errors: [
          {
            field: 'imageIds',
            message: 'List every image of this piece, once, in the order they should appear.',
            code: 'ARRAY_MISMATCH',
          },
        ],
      });
    }
  }

  private async deleteObjects(image: GarmentImage): Promise<void> {
    for (const key of [image.storageKey, image.thumbnailKey]) {
      if (key === null) {
        continue;
      }
      try {
        await this.storage.delete(key);
      } catch {
        this.logger.warn('Could not remove a stored object for a deleted image. It is orphaned.');
      }
    }
  }

  private present(image: GarmentImage): GarmentImageResponseDto {
    return toGarmentImageResponse(image, (key) => this.storage.signedUrl(key));
  }

  /** The same DTO, with every URL scoped to one account (§3.4). See {@link findPrimaryForGarments}. */
  private presentFor(image: GarmentImage, subject: string): GarmentImageResponseDto {
    return toGarmentImageResponse(image, (key) => this.storage.signedUrl(key, subject));
  }

  /* A-3 — emitted, never written here. The `audit` module's listener owns the row (§2.9 rule 4). */

  private emitImageAudit(
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    garment: Garment,
    image: GarmentImage,
    actor: ICurrentUser,
    metadata: Record<string, unknown>,
  ): void {
    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action,
        targetType: AUDIT_TARGET_TYPES.GARMENT_IMAGE,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: image.id,
        targetLabel: garment.title,
        // No `storageKey`, no `key` — a storage key belongs in neither a response nor a log
        // line (§3.4, E-12).
        metadata: { garmentId: garment.id, ...metadata },
      }),
    );
  }

  private emitAudit(
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    garment: Garment,
    actor: ICurrentUser,
    metadata: Record<string, unknown>,
  ): void {
    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action,
        targetType: AUDIT_TARGET_TYPES.GARMENT,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: garment.id,
        targetLabel: garment.title,
        metadata,
      }),
    );
  }
}
