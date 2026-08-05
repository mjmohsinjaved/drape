import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository, type SelectQueryBuilder } from 'typeorm';

import { ErrorCode, NotFoundException, type IPaginated, type SortOrder } from '@library/common';
import { paginate } from '@library/database';
import { StorageService } from '@library/storage';

import { Category } from '@api/modules/categories/entities/category.entity';
import { GarmentImage } from '@api/modules/garments/entities/garment-image.entity';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import {
  CatalogFacetDto,
  CatalogFiltersResponseDto,
  CatalogPriceRangeDto,
} from '../dto/catalog-filters-response.dto';
import {
  PublicGarmentDetailDto,
  PublicGarmentSummaryDto,
} from '../dto/public-garment-response.dto';
import {
  toPublicGarmentDetail,
  toPublicGarmentSummary,
  type PublicGarmentContext,
} from '../mappers/public-garment.mapper';
import {
  CATALOG_CATEGORY_ALIAS,
  CATALOG_GARMENT_ALIAS,
  isPubliclyVisible,
  onlyPubliclyVisible,
  publicGarmentScope,
} from '../queries/public-garment.scope';

import type { CatalogQueryDto, NewArrivalsQueryDto } from '../dto/catalog-query.dto';

/** Every primary key in the schema is a uuid (§4.0 rule 1); this tells one from a slug. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raw row shape of a facet aggregate. `COUNT(*)` comes back from `pg` as a string. */
interface FacetRow {
  value: string | null;
  count: string;
}

/** Raw row shape of the price-range aggregate. */
interface PriceRangeRow {
  min: string | null;
  max: string | null;
  currency: string | null;
}

/**
 * The **public** catalog projection — PRD C-1, C-8, C-17, C-18, ARCHITECTURE §5.8.
 *
 * > C-1: "Browsing is public. Catalog, categories, search, filters and garment detail
 * > are reachable while signed out."
 *
 * This module owns no entities (§4.33). It reads `garments`, `garment_images` and
 * `categories` through the repositories their owning modules export, and it writes
 * nothing at all — which is the whole reason it exists as a separate module rather
 * than as a `public: true` flag on `GarmentsService`. A flag would mean the query
 * that serves admins and the query that serves the world differ by a boolean somebody
 * has to remember to pass.
 *
 * Two rules carry the module:
 *
 * 1. **Visibility is decided in `queries/public-garment.scope.ts` and nowhere else.**
 *    Every query here starts from {@link visible}, and every row leaves through
 *    `onlyPubliclyVisible` / `isPubliclyVisible`. A garment lacking an approved test
 *    render cannot be reached by any route, filter, sort or search term (A-11, E-10).
 * 2. **A-30's price toggle is read once per request and applied in the mapper.**
 *    When `catalog.showPricesPublicly` is off, no price, currency or deposit appears
 *    in any response, the price band filters are ignored rather than honoured, the
 *    price sorts fall back to newest, and `GET /catalog/filters` omits the range —
 *    because a filter that narrows by price discloses prices a binary search at a time.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(GarmentImage)
    private readonly images: Repository<GarmentImage>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * `GET /catalog/garments` — the browse grid (C-1, C-17).
   *
   * Filters: category (including its sub-categories), colour, size, embellishment
   * weight, mode and price band. Search spans title, category name, colour and style
   * tags, exactly as C-17 words it.
   */
  async list(query: CatalogQueryDto): Promise<IPaginated<PublicGarmentSummaryDto>> {
    const showPrices = await this.showPrices();
    const qb = this.visible();

    if (query.search !== undefined) {
      qb.leftJoin(`${CATALOG_GARMENT_ALIAS}.category`, CATALOG_CATEGORY_ALIAS);
    }

    await this.applyFilters(qb, query, showPrices);
    this.applySort(qb, query.sortBy, showPrices);

    // No `sortableColumns`: the ordering is applied above, because §5.8's sort keys
    // are names for orderings ("newest", "priceAsc"), not column names.
    const page = await paginate(qb, query);

    return {
      items: await this.presentMany(onlyPubliclyVisible(page.items), showPrices),
      meta: page.meta,
    };
  }

  /**
   * `GET /catalog/garments/:slugOrId` — garment detail (C-18).
   *
   * A garment that is not publicly visible is `GARMENT_NOT_FOUND`, not a 403 and not
   * a distinguishable "exists but hidden": a draft piece must be indistinguishable
   * from one that never existed (S-9).
   */
  async findOne(slugOrId: string): Promise<PublicGarmentDetailDto> {
    const qb = this.visible();

    if (UUID_PATTERN.test(slugOrId)) {
      qb.andWhere(`${CATALOG_GARMENT_ALIAS}.id = :slugOrId`, { slugOrId });
    } else {
      qb.andWhere(`${CATALOG_GARMENT_ALIAS}.slug = :slugOrId`, { slugOrId });
    }

    const garment = await qb.getOne();
    if (garment === null || !isPubliclyVisible(garment)) {
      throw new NotFoundException(ErrorCode.GARMENT_NOT_FOUND);
    }

    const [category, images, showPrices] = await Promise.all([
      this.categories.findOne({ where: { id: garment.categoryId } }),
      this.images.find({ where: { garmentId: garment.id }, order: { position: 'ASC' } }),
      this.showPrices(),
    ]);

    return toPublicGarmentDetail(garment, {
      category: category ?? undefined,
      images,
      showPrices,
      sign: this.sign,
    });
  }

  /**
   * `GET /catalog/filters` — "available filter facets with counts, so the UI never
   * offers an empty filter" (§5.8, C-17).
   *
   * Every aggregate runs over {@link visible}, so a facet cannot advertise a garment
   * the grid would refuse to return.
   */
  async filters(): Promise<CatalogFiltersResponseDto> {
    const showPrices = await this.showPrices();

    const [colors, sizes, weights, modes, categoryCounts, priceRange] = await Promise.all([
      this.facets(`unnest(${CATALOG_GARMENT_ALIAS}.colors)`),
      this.facets(`unnest(${CATALOG_GARMENT_ALIAS}.sizes)`),
      this.facets(`${CATALOG_GARMENT_ALIAS}.embellishmentWeight`),
      this.facets(`${CATALOG_GARMENT_ALIAS}.mode`),
      this.facets(`${CATALOG_GARMENT_ALIAS}.categoryId`),
      showPrices ? this.priceRange() : Promise.resolve(null),
    ]);

    const categoryRows =
      categoryCounts.length === 0
        ? []
        : await this.categories.find({
            where: { id: In(categoryCounts.map((facet) => facet.value)) },
          });
    const labels = new Map(categoryRows.map((row) => [row.id, row.name]));

    const dto = new CatalogFiltersResponseDto();
    dto.colors = colors;
    dto.sizes = sizes;
    dto.embellishmentWeights = weights;
    dto.modes = modes;
    dto.categories = categoryCounts.map((facet) => {
      facet.label = labels.get(facet.value) ?? null;
      return facet;
    });
    dto.priceRange = priceRange;
    return dto;
  }

  /**
   * `GET /catalog/new-arrivals` — recently published (C-8, §5.8).
   *
   * The C-8 personalisation ("optionally scoped to `preferredCategories` for a
   * signed-in consumer") is expressed here as an explicit `categoryId`. Reading a
   * consumer's stored preferences means reading `consumer_profiles`, which belongs to
   * `users`; the seam is deliberate and the caller passes the scope in.
   */
  async newArrivals(query: NewArrivalsQueryDto): Promise<PublicGarmentSummaryDto[]> {
    const showPrices = await this.showPrices();
    const qb = this.visible();

    if (query.categoryId !== undefined) {
      await this.scopeToCategory(qb, query.categoryId);
    }

    const rows = await qb
      .orderBy(`${CATALOG_GARMENT_ALIAS}.publishedAt`, 'DESC', 'NULLS LAST')
      .addOrderBy(`${CATALOG_GARMENT_ALIAS}.id`, 'DESC')
      .take(query.limit)
      .getMany();

    return this.presentMany(onlyPubliclyVisible(rows), showPrices);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /** Signs a storage key. Bound so it can be handed to a pure mapper (§3.4). */
  private readonly sign = (storageKey: string): string => this.storage.signedUrl(storageKey);

  /**
   * **The only way this module builds a garment query.**
   *
   * Every public read starts here, so the A-11 / E-10 predicate is applied by
   * construction rather than by remembering.
   */
  private visible(): SelectQueryBuilder<Garment> {
    return publicGarmentScope(this.garments.createQueryBuilder(CATALOG_GARMENT_ALIAS));
  }

  /** A-30, read through the cached settings getter — never from the table (§4.28). */
  private async showPrices(): Promise<boolean> {
    return this.settings.getBoolean(SETTINGS_KEYS.CATALOG_SHOW_PRICES_PUBLICLY);
  }

  private async applyFilters(
    qb: SelectQueryBuilder<Garment>,
    query: CatalogQueryDto,
    showPrices: boolean,
  ): Promise<void> {
    if (query.categoryId !== undefined) {
      await this.scopeToCategory(qb, query.categoryId);
    }
    if (query.color !== undefined) {
      qb.andWhere(`:color = ANY(${CATALOG_GARMENT_ALIAS}.colors)`, { color: query.color });
    }
    if (query.size !== undefined) {
      qb.andWhere(`:size = ANY(${CATALOG_GARMENT_ALIAS}.sizes)`, { size: query.size });
    }
    if (query.embellishmentWeight !== undefined) {
      qb.andWhere(`${CATALOG_GARMENT_ALIAS}.embellishmentWeight = :embellishmentWeight`, {
        embellishmentWeight: query.embellishmentWeight,
      });
    }
    if (query.mode !== undefined) {
      qb.andWhere(`${CATALOG_GARMENT_ALIAS}.mode = :mode`, { mode: query.mode });
    }

    // A-30: while prices are hidden, a price band filter is a price oracle. Ignored,
    // not rejected — a stale bookmark should still return the catalogue, not an error.
    if (showPrices && query.priceMin !== undefined) {
      qb.andWhere(`${CATALOG_GARMENT_ALIAS}.price >= :priceMin`, { priceMin: query.priceMin });
    }
    if (showPrices && query.priceMax !== undefined) {
      qb.andWhere(`${CATALOG_GARMENT_ALIAS}.price <= :priceMax`, { priceMax: query.priceMax });
    }

    if (query.search !== undefined) {
      // C-17: "Search across title, category, color and style tags."
      qb.andWhere(
        `(${CATALOG_GARMENT_ALIAS}.title ILIKE :search` +
          ` OR ${CATALOG_CATEGORY_ALIAS}.name ILIKE :search` +
          ` OR EXISTS (SELECT 1 FROM unnest(${CATALOG_GARMENT_ALIAS}.colors) AS colour` +
          ` WHERE colour ILIKE :search)` +
          ` OR EXISTS (SELECT 1 FROM unnest(${CATALOG_GARMENT_ALIAS}.styleTags) AS tag` +
          ` WHERE tag ILIKE :search))`,
        { search: `%${query.search}%` },
      );
    }
  }

  /**
   * Category filtering includes the category's sub-categories.
   *
   * A-5 allows one level of nesting, so browsing "Bridal" must not hide the pieces
   * filed under "Bridal › Lehenga" — a filter that silently excluded them would read
   * as an empty category to a visitor.
   */
  private async scopeToCategory(
    qb: SelectQueryBuilder<Garment>,
    categoryId: string,
  ): Promise<void> {
    const rows = await this.categories.find({
      where: [{ id: categoryId }, { parentId: categoryId }],
    });

    // An unknown id yields an empty catalogue rather than the whole one. `[categoryId]`
    // keeps the SQL valid and matching nothing.
    const categoryIds = rows.length === 0 ? [categoryId] : rows.map((row) => row.id);

    qb.andWhere(`${CATALOG_GARMENT_ALIAS}.categoryId IN (:...categoryIds)`, { categoryIds });
  }

  /** The four §5.8 sorts. Price sorts fall back to newest while prices are hidden (A-30). */
  private applySort(qb: SelectQueryBuilder<Garment>, sortBy: string, showPrices: boolean): void {
    const priceSortsAvailable = showPrices;

    switch (sortBy) {
      case 'mostTried':
        qb.orderBy(`${CATALOG_GARMENT_ALIAS}.tryOnCount`, 'DESC');
        break;
      case 'priceAsc':
        this.applyPriceOrNewest(qb, 'ASC', priceSortsAvailable);
        break;
      case 'priceDesc':
        this.applyPriceOrNewest(qb, 'DESC', priceSortsAvailable);
        break;
      default:
        qb.orderBy(`${CATALOG_GARMENT_ALIAS}.publishedAt`, 'DESC', 'NULLS LAST');
        break;
    }

    // Without a tie-breaker, two rows sharing a sort key can appear on two pages or
    // on none as the visitor scrolls (§2.8).
    qb.addOrderBy(`${CATALOG_GARMENT_ALIAS}.id`, 'DESC');
  }

  private applyPriceOrNewest(
    qb: SelectQueryBuilder<Garment>,
    direction: SortOrder,
    available: boolean,
  ): void {
    if (available) {
      qb.orderBy(`${CATALOG_GARMENT_ALIAS}.price`, direction);
      return;
    }
    qb.orderBy(`${CATALOG_GARMENT_ALIAS}.publishedAt`, 'DESC', 'NULLS LAST');
  }

  /** One facet aggregate over the visible catalogue. */
  private async facets(expression: string): Promise<CatalogFacetDto[]> {
    const rows = await this.visible()
      .select(expression, 'value')
      .addSelect('COUNT(*)', 'count')
      .groupBy('value')
      .orderBy('count', 'DESC')
      .getRawMany<FacetRow>();

    return rows
      .filter((row): row is FacetRow & { value: string } => row.value !== null)
      .map((row) => {
        const dto = new CatalogFacetDto();
        dto.value = row.value;
        dto.label = null;
        dto.count = Number(row.count);
        return dto;
      });
  }

  /**
   * The price band bounds over the visible catalogue.
   *
   * `MIN(currency)` because the catalogue is single-currency in V1 (`char(3)`
   * defaulting to `PKR`, §4.13) and an aggregate needs *some* aggregate; the day a
   * second currency appears, this is the line that has to change.
   */
  private async priceRange(): Promise<CatalogPriceRangeDto | null> {
    const row = await this.visible()
      .select(`MIN(${CATALOG_GARMENT_ALIAS}.price)`, 'min')
      .addSelect(`MAX(${CATALOG_GARMENT_ALIAS}.price)`, 'max')
      .addSelect(`MIN(${CATALOG_GARMENT_ALIAS}.currency)`, 'currency')
      .getRawOne<PriceRangeRow>();

    // `== null` covers both: TypeORM returns `undefined` for no row, doubles return `null`.
    if (row == null || row.min === null || row.max === null) {
      return null;
    }

    const dto = new CatalogPriceRangeDto();
    dto.min = Number(row.min);
    dto.max = Number(row.max);
    dto.currency = row.currency ?? 'PKR';
    return dto;
  }

  /**
   * A page of rows → public cards, in two extra queries rather than two per row.
   *
   * The rows have already been through `onlyPubliclyVisible`; this function does not
   * re-filter, so that "what may be returned" has one answer and it is upstream of here.
   */
  private async presentMany(
    rows: readonly Garment[],
    showPrices: boolean,
  ): Promise<PublicGarmentSummaryDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const garmentIds = rows.map((row) => row.id);
    const [categories, images] = await Promise.all([
      this.categories.find({ where: { id: In(rows.map((row) => row.categoryId)) } }),
      this.images.find({ where: { garmentId: In(garmentIds) }, order: { position: 'ASC' } }),
    ]);

    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const imagesByGarment = new Map<string, GarmentImage[]>();
    for (const image of images) {
      const bucket = imagesByGarment.get(image.garmentId);
      if (bucket === undefined) {
        imagesByGarment.set(image.garmentId, [image]);
      } else {
        bucket.push(image);
      }
    }

    return rows.map((garment) => {
      const context: PublicGarmentContext = {
        category: categoryById.get(garment.categoryId),
        images: imagesByGarment.get(garment.id) ?? [],
        showPrices,
        sign: this.sign,
      };
      return toPublicGarmentSummary(garment, context);
    });
  }
}
