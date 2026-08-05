import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, In, IsNull, Not, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  NotFoundException,
  ValidationException,
  type ICurrentUser,
} from '@library/common';
import { runInTransaction } from '@library/database';
import { StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  type AuditAction,
} from '@api/shared/constants/audit-actions.constant';

import { AdminCategoryResponseDto, PublicCategoryResponseDto } from '../dto/category-response.dto';
import { Category } from '../entities/category.entity';
import { toAdminCategory, toPublicCategory, type CategoryNode } from '../mappers/category.mapper';
import { MAX_CATEGORY_SLUG_LENGTH, slugify, suffixedSlug } from '../utils/slug.util';

import type { AdminCategoryQueryDto } from '../dto/category-response.dto';
import type { CreateCategoryDto } from '../dto/create-category.dto';
import type { ReorderCategoriesDto } from '../dto/reorder-categories.dto';
import type { UpdateCategoryDto } from '../dto/update-category.dto';

/** How many `slug`, `slug-2`, `slug-3` … candidates to try before giving up. */
const MAX_SLUG_ATTEMPTS = 50;

/**
 * The taxonomy — PRD A-4 … A-7, ARCHITECTURE §5.5.
 *
 * Four invariants run through every method here:
 *
 * 1. **One level of nesting (A-5).** A category whose `parentId` is set may not
 *    itself become a parent, and a category that already has children may not be
 *    given a parent. Both directions raise `CATEGORY_DEPTH_EXCEEDED`, because a
 *    rule enforced in only one direction is a rule you can walk around.
 * 2. **A category holding published garments cannot be deleted (A-7).** The guard
 *    reads `publishedGarmentCount` — the denormalised counter §4.12 exists for
 *    exactly this — for the category *and its sub-categories*, inside the delete
 *    transaction, so the count cannot move between the check and the write.
 * 3. **Ordering is explicit and total.** `position` drives the consumer browse
 *    screen (A-6), so `reorder` renumbers a whole sibling set `0…n-1` in one
 *    transaction and refuses a partial set. Half a renumbering is duplicate
 *    positions, which is a browse screen that changes order between two page loads.
 * 4. **Nothing is hard-deleted.** DELETE soft-deletes (`deletedAt`), which is also
 *    what keeps the `RESTRICT` foreign keys from `garments` satisfiable.
 *
 * Two methods — {@link requireOpenCategory} and {@link applyPublishedGarmentDelta} —
 * are this module's contract with `garments`. They exist so that `GarmentsService`
 * never has to touch a `categories` row itself (§2.9 rule 5).
 */
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly storage: StorageService,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Reads
   * -------------------------------------------------------------------------------------- */

  /**
   * `GET /categories` (PUBLIC) — the browse tree in `position` order (A-6, C-1).
   *
   * Archived nodes are excluded here and nowhere else, so there is one answer to
   * "what can a signed-out visitor see". A child whose parent is archived disappears
   * with it: the tree is assembled from the surviving parents, so an orphaned child
   * has nothing to hang from and is never emitted.
   */
  async findPublicTree(): Promise<PublicCategoryResponseDto[]> {
    const rows = await this.categories.find({
      where: { archived: false },
      order: { position: 'ASC', name: 'ASC' },
    });

    return this.assemble(rows).map((node) => toPublicCategory(node, this.sign));
  }

  /** `GET /admin/categories` — the full tree with garment counts (§5.5). */
  async findAdminTree(query: AdminCategoryQueryDto): Promise<AdminCategoryResponseDto[]> {
    const rows = await this.categories.find({
      where: query.includeArchived ? {} : { archived: false },
      order: { position: 'ASC', name: 'ASC' },
    });

    return this.assemble(rows).map((node) => toAdminCategory(node, this.sign));
  }

  /* -----------------------------------------------------------------------------------------
   * Writes
   * -------------------------------------------------------------------------------------- */

  /** `POST /admin/categories` — create a category or a one-level sub-category (A-4, A-5). */
  async create(dto: CreateCategoryDto, actor: ICurrentUser): Promise<AdminCategoryResponseDto> {
    const parentId = dto.parentId ?? null;
    if (parentId !== null) {
      await this.assertUsableParent(parentId);
    }

    const category = this.categories.create({
      name: dto.name,
      nameUr: dto.nameUr ?? null,
      slug: await this.resolveSlug(dto.slug ?? dto.name),
      parentId,
      coverImageKey: dto.coverImageKey ?? null,
      position: dto.position ?? (await this.nextPosition(parentId)),
      archived: false,
      archivedAt: null,
      publishedGarmentCount: 0,
    });

    const saved = await this.categories.save(category);

    this.emitAudit(AUDIT_ACTIONS.CATEGORY_CREATED, saved, actor, {
      parentId,
      position: saved.position,
    });

    return this.present(saved);
  }

  /** `PATCH /admin/categories/:categoryId` — rename, re-parent, set cover image (§5.5). */
  async update(
    categoryId: string,
    dto: UpdateCategoryDto,
    actor: ICurrentUser,
  ): Promise<AdminCategoryResponseDto> {
    const category = await this.requireCategory(categoryId);
    const changed: Record<string, unknown> = {};

    if (dto.parentId !== undefined) {
      await this.applyReparent(category, dto.parentId);
      changed.parentId = dto.parentId;
    }

    if (dto.name !== undefined) {
      category.name = dto.name;
      changed.categoryName = dto.name;
    }
    if (dto.nameUr !== undefined) {
      category.nameUr = dto.nameUr;
    }
    if (dto.slug !== undefined) {
      category.slug = await this.resolveSlug(dto.slug, category.id);
      changed.categorySlug = category.slug;
    }
    if (dto.coverImageKey !== undefined) {
      category.coverImageKey = dto.coverImageKey;
      // The key itself is not audited — §3.4 and E-12 keep storage keys out of logs.
      changed.coverImageChanged = true;
    }
    if (dto.position !== undefined) {
      category.position = dto.position;
      changed.position = dto.position;
    }

    const saved = await this.categories.save(category);
    this.emitAudit(AUDIT_ACTIONS.CATEGORY_UPDATED, saved, actor, changed);

    return this.present(saved);
  }

  /**
   * `POST /admin/categories/reorder` — persist a new sort order for a sibling set (A-4).
   *
   * Atomic by construction: every affected row is renumbered inside one
   * `runInTransaction`, so a failure halfway through leaves the previous order
   * intact rather than a half-renumbered set with duplicate positions.
   *
   * The payload must name **every** sibling. A partial set is refused rather than
   * merged, because merging is where two rows end up sharing a position and the
   * browse screen starts reordering itself between page loads.
   */
  async reorder(
    dto: ReorderCategoriesDto,
    actor: ICurrentUser,
  ): Promise<AdminCategoryResponseDto[]> {
    const parentId = dto.parentId ?? null;

    const ordered = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<Category[]> => {
        const repository = manager.getRepository(Category);
        const siblings = await repository.find({
          where: parentId === null ? { parentId: IsNull() } : { parentId },
        });

        this.assertCompleteSiblingSet(siblings, dto.categoryIds);

        const byId = new Map(siblings.map((sibling) => [sibling.id, sibling]));
        const result: Category[] = [];

        for (const [index, categoryId] of dto.categoryIds.entries()) {
          const sibling = byId.get(categoryId);
          if (sibling === undefined) {
            // Unreachable: assertCompleteSiblingSet has already proved set equality.
            throw new NotFoundException(ErrorCode.CATEGORY_NOT_FOUND);
          }
          sibling.position = index;
          result.push(sibling);
        }

        await repository.save(result);
        return result;
      },
      { label: 'categories.reorder' },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.CATEGORY_REORDERED,
        targetType: AUDIT_TARGET_TYPES.CATEGORY,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: parentId,
        targetLabel: parentId === null ? 'top level' : null,
        metadata: { parentId, order: dto.categoryIds },
      }),
    );

    return ordered.map((category) => toAdminCategory({ category, children: [] }, this.sign));
  }

  /**
   * `POST /admin/categories/:categoryId/archive` (A-7).
   *
   * Idempotent: archiving an archived category returns it unchanged. The console's
   * intent — "this should not appear on the browse screen" — is already satisfied,
   * and raising would make a double-click look like a failure.
   */
  async archive(categoryId: string, actor: ICurrentUser): Promise<AdminCategoryResponseDto> {
    const category = await this.requireCategory(categoryId);
    if (category.archived) {
      return this.present(category);
    }

    category.archived = true;
    category.archivedAt = new Date();
    const saved = await this.categories.save(category);

    this.emitAudit(AUDIT_ACTIONS.CATEGORY_ARCHIVED, saved, actor, {
      publishedGarmentCount: saved.publishedGarmentCount,
    });

    return this.present(saved);
  }

  /** `POST /admin/categories/:categoryId/restore` — un-archive (§5.5). */
  async restore(categoryId: string, actor: ICurrentUser): Promise<AdminCategoryResponseDto> {
    const category = await this.requireCategory(categoryId);
    if (!category.archived) {
      return this.present(category);
    }

    // Restoring a child under an archived parent would produce a node that is
    // "restored" and still invisible on the browse screen. Refuse and say why.
    if (category.parentId !== null) {
      const parent = await this.requireCategory(category.parentId);
      if (parent.archived) {
        throw new ConflictException(ErrorCode.CATEGORY_ARCHIVED, {
          message: 'Restore the parent category first.',
          details: { parentId: parent.id },
        });
      }
    }

    category.archived = false;
    category.archivedAt = null;
    const saved = await this.categories.save(category);

    this.emitAudit(AUDIT_ACTIONS.CATEGORY_RESTORED, saved, actor, {});

    return this.present(saved);
  }

  /**
   * `DELETE /admin/categories/:categoryId` — **A-7**.
   *
   * > "A category holding published garments cannot be deleted, only archived."
   *
   * The count is read **inside the transaction** and covers the category's
   * sub-categories as well, because deleting a parent takes its children with it and
   * a published garment two levels down is just as published.
   *
   * `publishedGarmentCount` rather than a `garments` query: §4.12 declares that
   * column to be what "the A-7 delete guard reads", `garments` belongs to another
   * module (§2.9 rule 5), and `GarmentsService` maintains the counter inside the very
   * same transaction as the publish it describes (see {@link applyPublishedGarmentDelta}).
   */
  async remove(categoryId: string, actor: ICurrentUser): Promise<void> {
    const deleted = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<Category> => {
        const repository = manager.getRepository(Category);

        const category = await repository.findOne({ where: { id: categoryId } });
        if (category === null) {
          throw new NotFoundException(ErrorCode.CATEGORY_NOT_FOUND);
        }

        const children = await repository.find({ where: { parentId: category.id } });
        const published =
          category.publishedGarmentCount +
          children.reduce((total, child) => total + child.publishedGarmentCount, 0);

        if (published > 0) {
          throw new ConflictException(ErrorCode.CATEGORY_HAS_PUBLISHED_GARMENTS, {
            details: {
              categoryId: category.id,
              publishedGarmentCount: published,
              subCategoryCount: children.length,
            },
          });
        }

        if (children.length > 0) {
          await repository.softDelete(children.map((child) => child.id));
        }
        await repository.softDelete(category.id);

        return category;
      },
      { label: 'categories.remove' },
    );

    this.emitAudit(AUDIT_ACTIONS.CATEGORY_DELETED, deleted, actor, { parentId: deleted.parentId });
  }

  /* -----------------------------------------------------------------------------------------
   * The contract with `garments`
   * -------------------------------------------------------------------------------------- */

  /**
   * Resolves a category a garment may be filed under, or refuses.
   *
   * `GarmentsService` calls this instead of holding a `Category` repository of its
   * own (§2.9 rule 5). An archived category is refused: A-7 archives a category to
   * take it off the browse screen, and letting new pieces land in it would quietly
   * undo that.
   */
  async requireOpenCategory(categoryId: string): Promise<Category> {
    const category = await this.requireCategory(categoryId);
    if (category.archived) {
      throw new ConflictException(ErrorCode.CATEGORY_ARCHIVED, { details: { categoryId } });
    }
    return category;
  }

  /**
   * A category by id, or `null` when it does not exist.
   *
   * Unlike {@link requireOpenCategory} this neither throws nor cares about archive
   * state: `garments` uses it to *label* a row, and a garment filed under a category
   * that was archived afterwards must still render its category name.
   */
  async findById(categoryId: string): Promise<Category | null> {
    return this.categories.findOne({ where: { id: categoryId } });
  }

  /**
   * The categories behind a page of garments, keyed by id.
   *
   * One query for the whole page rather than one per row — the admin catalog list is
   * the screen most likely to be opened with a large page size, and an N+1 there is
   * an N+1 on the busiest admin screen there is.
   */
  async findByIds(categoryIds: readonly string[]): Promise<ReadonlyMap<string, Category>> {
    const unique = [...new Set(categoryIds)];
    if (unique.length === 0) {
      return new Map();
    }

    const rows = await this.categories.find({ where: { id: In(unique) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Moves `publishedGarmentCount` by `delta` **inside the caller's transaction**.
   *
   * The manager is passed in rather than opened here on purpose: the counter and the
   * `publishState` change it describes must commit or roll back together, or the A-7
   * delete guard starts protecting categories that hold nothing and releasing ones
   * that do.
   *
   * Read-modify-write rather than `increment()` so the floor at zero is explicit: a
   * counter that has drifted negative would silently disarm the guard.
   */
  async applyPublishedGarmentDelta(
    manager: EntityManager,
    categoryId: string,
    delta: number,
  ): Promise<void> {
    if (delta === 0) {
      return;
    }

    const repository = manager.getRepository(Category);
    const category = await repository.findOne({ where: { id: categoryId } });
    if (category === null) {
      return;
    }

    await repository.update(
      { id: categoryId },
      { publishedGarmentCount: Math.max(0, category.publishedGarmentCount + delta) },
    );
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /** Signs a storage key. Bound so it can be handed to a pure mapper (§3.4). */
  private readonly sign = (storageKey: string): string => this.storage.signedUrl(storageKey);

  private async requireCategory(categoryId: string): Promise<Category> {
    const category = await this.categories.findOne({ where: { id: categoryId } });
    if (category === null) {
      throw new NotFoundException(ErrorCode.CATEGORY_NOT_FOUND);
    }
    return category;
  }

  /** A single node with its children resolved, for a mutation response. */
  private async present(category: Category): Promise<AdminCategoryResponseDto> {
    const children =
      category.parentId === null
        ? await this.categories.find({
            where: { parentId: category.id },
            order: { position: 'ASC', name: 'ASC' },
          })
        : [];

    return toAdminCategory({ category, children }, this.sign);
  }

  /** Groups a flat, ordered row set into the one-level tree A-5 permits. */
  private assemble(rows: readonly Category[]): CategoryNode[] {
    const childrenByParent = new Map<string, Category[]>();
    for (const row of rows) {
      if (row.parentId === null) {
        continue;
      }
      const bucket = childrenByParent.get(row.parentId);
      if (bucket === undefined) {
        childrenByParent.set(row.parentId, [row]);
      } else {
        bucket.push(row);
      }
    }

    return rows
      .filter((row) => row.parentId === null)
      .map((category) => ({ category, children: childrenByParent.get(category.id) ?? [] }));
  }

  /**
   * **A-5, on create.** The proposed parent must exist, must be usable, and must not
   * itself have a parent — a grandchild is two levels deep.
   */
  private async assertUsableParent(parentId: string): Promise<void> {
    const parent = await this.requireCategory(parentId);

    if (parent.parentId !== null) {
      throw new ValidationException(ErrorCode.CATEGORY_DEPTH_EXCEEDED, {
        details: { parentId: parent.id, grandParentId: parent.parentId },
      });
    }
    if (parent.archived) {
      throw new ConflictException(ErrorCode.CATEGORY_ARCHIVED, {
        details: { parentId: parent.id },
      });
    }
  }

  /**
   * **A-5, on update.** Re-parenting is refused from both directions: a category
   * cannot be filed under a sub-category, and a category that already has children
   * cannot be filed under anything.
   */
  private async applyReparent(category: Category, parentId: string | null): Promise<void> {
    if (parentId === null) {
      category.parentId = null;
      return;
    }

    if (parentId === category.id) {
      throw new ValidationException(ErrorCode.CATEGORY_DEPTH_EXCEEDED, {
        message: 'A category cannot be its own parent.',
        details: { categoryId: category.id },
      });
    }

    await this.assertUsableParent(parentId);

    const childCount = await this.categories.count({ where: { parentId: category.id } });
    if (childCount > 0) {
      throw new ValidationException(ErrorCode.CATEGORY_DEPTH_EXCEEDED, {
        details: { categoryId: category.id, subCategoryCount: childCount },
      });
    }

    category.parentId = parentId;
  }

  /** Reorder is all-or-nothing: the payload and the stored sibling set must match exactly. */
  private assertCompleteSiblingSet(siblings: readonly Category[], categoryIds: string[]): void {
    const stored = new Set(siblings.map((sibling) => sibling.id));
    const requested = new Set(categoryIds);

    const missing = [...stored].filter((id) => !requested.has(id));
    const unknown = categoryIds.filter((id) => !stored.has(id));

    if (missing.length > 0 || unknown.length > 0) {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        message: 'Send every category in this set, in the order it should appear.',
        errors: [
          {
            field: 'categoryIds',
            message: 'The list must contain exactly the categories in this sibling set.',
            code: 'REORDER_SET_MISMATCH',
          },
        ],
        details: { missingCount: missing.length, unknownCount: unknown.length },
      });
    }
  }

  /** Appends to the end of a sibling set when the caller did not choose a position. */
  private async nextPosition(parentId: string | null): Promise<number> {
    const siblings = await this.categories.find({
      where: parentId === null ? { parentId: IsNull() } : { parentId },
    });

    return siblings.reduce((highest, sibling) => Math.max(highest, sibling.position + 1), 0);
  }

  /**
   * A unique slug for a stem, ignoring the row being updated.
   *
   * The unique index carries `WHERE "deletedAt" IS NULL`, so a soft-deleted category
   * does not reserve its slug — the lookup here matches that by not asking for
   * deleted rows.
   */
  private async resolveSlug(stem: string, excludeId?: string): Promise<string> {
    const base = slugify(stem, MAX_CATEGORY_SLUG_LENGTH);
    if (base === '') {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        message: 'Give this category a name with at least one Latin letter or digit.',
        errors: [{ field: 'slug', message: 'slug could not be derived', code: 'SLUG_EMPTY' }],
      });
    }

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const candidate = suffixedSlug(base, attempt, MAX_CATEGORY_SLUG_LENGTH);
      const clash = await this.categories.findOne({
        where:
          excludeId === undefined ? { slug: candidate } : { slug: candidate, id: Not(excludeId) },
      });
      if (clash === null) {
        return candidate;
      }
    }

    throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
      message: 'Too many categories share this name. Give this one a distinct name.',
    });
  }

  /** A-3 — every catalog change is audited (§2.9 rule 4: emit, never write). */
  private emitAudit(
    action: AuditAction,
    category: Category,
    actor: ICurrentUser,
    metadata: Record<string, unknown>,
  ): void {
    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action,
        targetType: AUDIT_TARGET_TYPES.CATEGORY,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: category.id,
        targetLabel: category.name,
        metadata: { categorySlug: category.slug, ...metadata },
      }),
    );
  }
}
