import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';

import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export const CATALOG_GARMENT_ALIAS = 'garment';

export const CATALOG_CATEGORY_ALIAS = 'category';

export function publicGarmentScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string = CATALOG_GARMENT_ALIAS,
): SelectQueryBuilder<T> {
  return qb
    .andWhere(`${alias}.deletedAt IS NULL`)
    .andWhere(`${alias}.publishState = :publicPublishState`, {
      publicPublishState: PublishState.PUBLISHED,
    });
}

export function isPubliclyVisible(garment: Garment): boolean {
  return garment.deletedAt === null && garment.publishState === PublishState.PUBLISHED;
}

export function onlyPubliclyVisible(garments: readonly Garment[]): Garment[] {
  return garments.filter(isPubliclyVisible);
}
