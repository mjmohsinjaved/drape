
import type { IsoDateTime, Uuid } from './common';

export interface PublicCategory {
  id: Uuid;
  name: string;
  nameUr: string | null;
  slug: string;
  coverImageUrl: string | null;
  position: number;
  children: PublicCategory[];
}

export interface AdminCategory {
  id: Uuid;
  name: string;
  nameUr: string | null;
  slug: string;
  parentId: Uuid | null;
  coverImageUrl: string | null;
  position: number;
  archived: boolean;
  archivedAt: IsoDateTime | null;
  publishedGarmentCount: number;
  publishedGarmentCountIncludingChildren: number;
  deletable: boolean;
  createdAt: IsoDateTime;
  children: AdminCategory[];
}

/** `GET /admin/categories`. The admin tree is complete by default, archived rows included. */
export interface AdminCategoryQuery {
  includeArchived?: boolean;
}

/** `MAX_CATEGORY_NAME_LENGTH` from `CreateCategoryDto`. */
export const MAX_CATEGORY_NAME_LENGTH = 80;

export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CreateCategoryRequest {
  name: string;
  nameUr?: string;
  slug?: string;
  parentId?: Uuid;
  coverImageKey?: string;
  position?: number;
}

export interface UpdateCategoryRequest {
  name?: string;
  nameUr?: string | null;
  slug?: string;
  parentId?: Uuid | null;
  coverImageKey?: string | null;
  position?: number;
}

/** One reorder covers at most this many siblings. */
export const MAX_REORDER_BATCH = 200;

export interface ReorderCategoriesRequest {
  parentId?: Uuid | null;
  categoryIds: Uuid[];
}
