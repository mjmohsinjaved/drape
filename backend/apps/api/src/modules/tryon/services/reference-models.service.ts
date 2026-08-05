import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ErrorCode, NotFoundException } from '@library/common';
import { StorageService } from '@library/storage';

import { ReferenceModelResponseDto } from '../dto/test-render-response.dto';
import { ReferenceModel } from '../entities/reference-model.entity';

/**
 * `reference_models` — §4.15, PRD A-11 / E-4.
 *
 * > "These are the only person images an admin ever sends upstream; consumer photos are
 * > never used for a test render."
 *
 * That sentence is the reason this service exists as a separate thing from
 * `person-photos` rather than as a flag on it. There is no code path from the test
 * render to `person_photos`: `TestRenderService` resolves its person image from **this**
 * repository and `tryon_jobs` records it in `referenceModelId`, a different column from
 * `personPhotoId` (§4.17). S-10 is upheld by there being nothing to get wrong.
 */
@Injectable()
export class ReferenceModelsService {
  constructor(
    @InjectRepository(ReferenceModel)
    private readonly models: Repository<ReferenceModel>,
    private readonly storage: StorageService,
  ) {}

  /** `GET /admin/reference-models` — those available for a test render (§5.11). */
  async list(): Promise<ReferenceModelResponseDto[]> {
    const rows = await this.models.find({
      where: { active: true },
      order: { position: 'ASC' },
    });

    return rows.map((model) => this.toResponse(model));
  }

  /**
   * The model to use: the one named, or the default.
   *
   * A missing default is a seeding failure (E-4), not a request failure — but it
   * reaches an admin as `RESOURCE_NOT_FOUND` either way, so the message tells her
   * something actionable rather than leaking that a seeder did not run.
   */
  async resolve(referenceModelId?: string): Promise<ReferenceModel> {
    const model =
      referenceModelId === undefined
        ? await this.models.findOne({ where: { isDefault: true, active: true } })
        : await this.models.findOne({ where: { id: referenceModelId, active: true } });

    if (model === null) {
      throw new NotFoundException(ErrorCode.RESOURCE_NOT_FOUND, {
        message: 'No reference model is available for a test render.',
      });
    }
    return model;
  }

  private toResponse(model: ReferenceModel): ReferenceModelResponseDto {
    const dto = new ReferenceModelResponseDto();
    dto.id = model.id;
    dto.label = model.label;
    // A reference model is a stock image, not personal data — no subject scoping (§3.4).
    dto.thumbnailUrl =
      model.thumbnailKey === null ? null : this.storage.signedUrl(model.thumbnailKey);
    dto.isDefault = model.isDefault;
    dto.position = model.position;
    return dto;
  }
}
