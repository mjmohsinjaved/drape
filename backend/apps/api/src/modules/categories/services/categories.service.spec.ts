import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { AppException, ErrorCode, Role } from '@library/common';
import type { ICurrentUser } from '@library/common';
import { StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, type AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import {
  createFakeEntityManager,
  createTransactionalDataSource,
  type TransactionState,
} from '@api/modules/users/testing/query-doubles';
import { sessionFor } from '@api/modules/users/testing/route-authorisation';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

import { buildArchivedCategory, buildCategory, buildSubCategory } from '../../../../test/factories';
import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';
import { Category } from '../entities/category.entity';

import { CategoriesService } from './categories.service';

import type { InMemoryRepository } from '../../../../test/fixtures';

/**
 * `CategoriesService` — PRD A-4 … A-7.
 *
 * The two tests that carry real weight are **A-7** (a category holding published
 * garments cannot be deleted, only archived) and **A-5** (two levels of nesting is
 * refused). Everything else here exists to keep them honest: a delete guard that
 * passes because nothing is ever deleted is not a guard.
 */
describe('CategoriesService', () => {
  // Built from the same helper the authorisation specs use, so the actor's shape
  // follows `ICurrentUser` as it changes rather than being hand-rolled here.
  const admin: ICurrentUser = sessionFor(Role.ADMIN);

  interface Harness {
    service: CategoriesService;
    categories: InMemoryRepository<Category>;
    events: jest.Mocked<EventEmitter2>;
    transaction: TransactionState;
    close: () => Promise<void>;
  }

  async function arrange(rows: readonly Category[] = []): Promise<Harness> {
    const categories = createInMemoryRepository<Category>({ rows });
    const manager = createFakeEntityManager(new Map([[Category, categories]]));
    const { dataSource, state } = createTransactionalDataSource(manager);

    const events = createMock<EventEmitter2>(['emit']);
    const storage = createMock<StorageService>(['signedUrl']);
    storage.signedUrl.mockImplementation((key: string) => `https://api.test/files/${key}`);

    const harness = await createTestingModule({
      providers: [CategoriesService],
      overrides: [
        { token: getRepositoryToken(Category), value: categories },
        { token: DataSource, value: dataSource },
        { token: EventEmitter2, value: events },
        { token: StorageService, value: storage },
      ],
    });

    return {
      service: harness.get<CategoriesService>(CategoriesService),
      categories,
      events,
      transaction: state,
      close: harness.close,
    };
  }

  function auditActions(events: jest.Mocked<EventEmitter2>): string[] {
    return events.emit.mock.calls
      .filter(([name]) => name === AUDIT_RECORD_EVENT)
      .map(([, event]) => (event as AuditRecordEvent).input.action);
  }

  /* --------------------------------------------------------------------------------------- */

  describe('A-5 — sub-categories go exactly one level deep', () => {
    it('refuses a category whose parent already has a parent', async () => {
      const top = buildCategory();
      const child = buildSubCategory(top);
      const harness = await arrange([top, child]);

      await expect(
        harness.service.create({ name: 'Too deep', parentId: child.id }, admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CATEGORY_DEPTH_EXCEEDED });

      await harness.close();
    });

    it('refuses re-parenting a category that already has children', async () => {
      const top = buildCategory();
      const other = buildCategory();
      const child = buildSubCategory(top);
      const harness = await arrange([top, other, child]);

      await expect(
        harness.service.update(top.id, { parentId: other.id }, admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CATEGORY_DEPTH_EXCEEDED });

      await harness.close();
    });

    it('refuses a category becoming its own parent', async () => {
      const top = buildCategory();
      const harness = await arrange([top]);

      await expect(
        harness.service.update(top.id, { parentId: top.id }, admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CATEGORY_DEPTH_EXCEEDED });

      await harness.close();
    });

    it('permits one level', async () => {
      const top = buildCategory();
      const harness = await arrange([top]);

      const created = await harness.service.create({ name: 'Lehenga', parentId: top.id }, admin);

      expect(created.parentId).toBe(top.id);
      expect(auditActions(harness.events)).toEqual([AUDIT_ACTIONS.CATEGORY_CREATED]);

      await harness.close();
    });

    it('refuses filing a new category under an archived parent', async () => {
      const parent = buildArchivedCategory();
      const harness = await arrange([parent]);

      await expect(
        harness.service.create({ name: 'Orphan', parentId: parent.id }, admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CATEGORY_ARCHIVED });

      await harness.close();
    });
  });

  describe('A-7 — a category holding published garments cannot be deleted, only archived', () => {
    it('refuses DELETE and rolls the transaction back', async () => {
      const category = buildCategory({ publishedGarmentCount: 3 });
      const harness = await arrange([category]);

      await expect(harness.service.remove(category.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.CATEGORY_HAS_PUBLISHED_GARMENTS,
      });

      // Still there, and the guard ran inside a transaction that was rolled back.
      expect(harness.categories.$rows[0]?.deletedAt).toBeNull();
      expect(harness.transaction.rolledBack).toBe(1);
      expect(harness.transaction.committed).toBe(0);
      expect(auditActions(harness.events)).toEqual([]);

      await harness.close();
    });

    it('refuses DELETE when a sub-category holds the published garments', async () => {
      const parent = buildCategory({ publishedGarmentCount: 0 });
      const child = buildSubCategory(parent, { publishedGarmentCount: 2 });
      const harness = await arrange([parent, child]);

      await expect(harness.service.remove(parent.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.CATEGORY_HAS_PUBLISHED_GARMENTS,
      });

      await harness.close();
    });

    it('archives the same category successfully', async () => {
      const category = buildCategory({ publishedGarmentCount: 3 });
      const harness = await arrange([category]);

      const archived = await harness.service.archive(category.id, admin);

      expect(archived.archived).toBe(true);
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(archived.deletable).toBe(false);
      expect(auditActions(harness.events)).toEqual([AUDIT_ACTIONS.CATEGORY_ARCHIVED]);

      await harness.close();
    });

    it('deletes an empty category, taking its sub-categories with it', async () => {
      const parent = buildCategory();
      const child = buildSubCategory(parent);
      const harness = await arrange([parent, child]);

      await harness.service.remove(parent.id, admin);

      expect(harness.categories.$rows.every((row) => row.deletedAt !== null)).toBe(true);
      expect(harness.transaction.committed).toBe(1);
      expect(auditActions(harness.events)).toEqual([AUDIT_ACTIONS.CATEGORY_DELETED]);

      await harness.close();
    });

    it('surfaces the blocking count so the console can explain the refusal', async () => {
      const parent = buildCategory({ publishedGarmentCount: 1 });
      const child = buildSubCategory(parent, { publishedGarmentCount: 4 });
      const harness = await arrange([parent, child]);

      const error = await harness.service
        .remove(parent.id, admin)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).details).toMatchObject({ publishedGarmentCount: 5 });

      await harness.close();
    });
  });

  describe('reorder — atomic across the affected siblings (A-4, A-6)', () => {
    it('renumbers the whole set 0…n-1 in one transaction', async () => {
      const first = buildCategory({ position: 0 });
      const second = buildCategory({ position: 1 });
      const third = buildCategory({ position: 2 });
      const harness = await arrange([first, second, third]);

      const ordered = await harness.service.reorder(
        { categoryIds: [third.id, first.id, second.id] },
        admin,
      );

      expect(ordered.map((category) => [category.id, category.position])).toEqual([
        [third.id, 0],
        [first.id, 1],
        [second.id, 2],
      ]);
      expect(harness.transaction.committed).toBe(1);
      expect(auditActions(harness.events)).toEqual([AUDIT_ACTIONS.CATEGORY_REORDERED]);

      await harness.close();
    });

    it('refuses a partial sibling set rather than merging it', async () => {
      const first = buildCategory({ position: 0 });
      const second = buildCategory({ position: 1 });
      const harness = await arrange([first, second]);

      await expect(
        harness.service.reorder({ categoryIds: [second.id] }, admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });

      expect(harness.transaction.committed).toBe(0);
      expect(harness.transaction.rolledBack).toBe(1);

      await harness.close();
    });

    it('refuses an id from another sibling set', async () => {
      const parent = buildCategory();
      const child = buildSubCategory(parent);
      const harness = await arrange([parent, child]);

      await expect(
        harness.service.reorder({ categoryIds: [parent.id, child.id] }, admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });

      await harness.close();
    });
  });

  describe('the public tree (A-6, C-1)', () => {
    it('is ordered by position and nests one level', async () => {
      const second = buildCategory({ name: 'Sharara', position: 1 });
      const first = buildCategory({ name: 'Bridal', position: 0 });
      const child = buildSubCategory(first, { name: 'Lehenga', position: 0 });
      const harness = await arrange([second, first, child]);

      const tree = await harness.service.findPublicTree();

      expect(tree.map((node) => node.name)).toEqual(['Bridal', 'Sharara']);
      expect(tree[0]?.children.map((node) => node.name)).toEqual(['Lehenga']);
      expect(tree[1]?.children).toEqual([]);

      await harness.close();
    });

    it('omits archived categories and the children hanging off them', async () => {
      const archived = buildArchivedCategory({ name: 'Retired' });
      const orphan = buildSubCategory(archived, { name: 'Retired child' });
      const live = buildCategory({ name: 'Live' });
      const harness = await arrange([archived, orphan, live]);

      const tree = await harness.service.findPublicTree();

      expect(tree.map((node) => node.name)).toEqual(['Live']);
      expect(JSON.stringify(tree)).not.toContain('Retired child');

      await harness.close();
    });

    it('never carries a storage key, a garment count or archive state', async () => {
      const category = buildCategory({ coverImageKey: 'categories/x/cover.webp' });
      const harness = await arrange([category]);

      const [node] = await harness.service.findPublicTree();

      // A signed URL, and no raw key field to leak one (§3.4, E-12).
      expect(node?.coverImageUrl).toBe('https://api.test/files/categories/x/cover.webp');
      expect(node).not.toHaveProperty('coverImageKey');
      expect(node).not.toHaveProperty('publishedGarmentCount');
      expect(node).not.toHaveProperty('archived');
      expect(node).not.toHaveProperty('parentId');

      await harness.close();
    });
  });

  describe('the contract with garments', () => {
    it('refuses filing a piece under an archived category', async () => {
      const archived = buildArchivedCategory();
      const harness = await arrange([archived]);

      await expect(harness.service.requireOpenCategory(archived.id)).rejects.toMatchObject({
        errorCode: ErrorCode.CATEGORY_ARCHIVED,
      });

      await harness.close();
    });

    it('refuses an unknown category', async () => {
      const harness = await arrange([]);

      await expect(
        harness.service.requireOpenCategory('11111111-2222-4333-8444-555555555555'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CATEGORY_NOT_FOUND });

      await harness.close();
    });

    it('moves the A-7 counter and floors it at zero', async () => {
      const category = buildCategory({ publishedGarmentCount: 1 });
      const harness = await arrange([category]);
      const manager = createFakeEntityManager(new Map([[Category, harness.categories]]));

      await harness.service.applyPublishedGarmentDelta(manager, category.id, 1);
      expect(harness.categories.$rows[0]?.publishedGarmentCount).toBe(2);

      await harness.service.applyPublishedGarmentDelta(manager, category.id, -5);
      expect(harness.categories.$rows[0]?.publishedGarmentCount).toBe(0);

      await harness.close();
    });
  });

  describe('slugs', () => {
    it('derives one from the name and de-duplicates it', async () => {
      const existing = buildCategory({ slug: 'bridal-lehenga' });
      const harness = await arrange([existing]);

      const created = await harness.service.create({ name: 'Bridal Lehenga' }, admin);

      expect(created.slug).toBe('bridal-lehenga-2');

      await harness.close();
    });

    it('refuses a name with nothing sluggable in it', async () => {
      const harness = await arrange([]);

      await expect(harness.service.create({ name: 'عروسی' }, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.VALIDATION_ERROR,
      });

      await harness.close();
    });
  });
});
