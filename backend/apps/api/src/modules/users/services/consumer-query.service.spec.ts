import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { getRepositoryToken } from '@nestjs/typeorm';

import { UserStatus } from '@library/common';

import { EnquiryItem } from '@api/modules/enquiries/entities/enquiry-item.entity';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { QuotaLedgerEntry } from '@api/modules/quota/entities/quota-ledger-entry.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';

import { buildUser } from '../../../../test/factories';
import {
  CONSUMER_USER_COLUMNS,
  PHOTO_FORBIDDEN_FRAGMENTS,
} from '../constants/consumer-visibility.constant';
import { ConsumerProfile } from '../entities/consumer-profile.entity';
import { User } from '../entities/user.entity';
import { createQueryBuilderSpy, type QueryBuilderSpy } from '../testing/query-doubles';

import { ConsumerQueryService } from './consumer-query.service';

import type { ConsumerQueryDto } from '../dto/consumer-query.dto';
import type { ConsumerRenderQueryDto } from '../dto/consumer-render-response.dto';
import type { ConsumerShortlistQueryDto } from '../dto/consumer-shortlist-response.dto';
import type { ObjectLiteral, Repository } from 'typeorm';

/**
 * **PRD S-10.**
 *
 * > "Admins cannot view consumer photos. They see renders only where a consumer has
 * > submitted an enquiry, plus blurred thumbnails in the moderation queue. Enforced
 * > in the query layer and covered by test."
 *
 * This is that test, and it is deliberately not a test of the response shape. A
 * mapper that happens to omit a photo today is one careless edit away from
 * including one; what these assertions pin down is that **the query cannot ask for a
 * photo in the first place** — no repository handle, no table name, no column, and
 * no path to a render except through an enquiry she actually submitted.
 */
describe('ConsumerQueryService — S-10', () => {
  const consumerId = 'c0000000-0000-4000-8000-000000000001';
  const otherConsumerId = 'c0000000-0000-4000-8000-000000000002';

  interface Harness {
    service: ConsumerQueryService;
    users: QueryBuilderSpy<User>;
    profiles: QueryBuilderSpy<ConsumerProfile>;
    shortlistItems: QueryBuilderSpy<ShortlistItem>;
    enquiries: QueryBuilderSpy<Enquiry>;
    enquiryItems: QueryBuilderSpy<EnquiryItem>;
    quotaLedger: QueryBuilderSpy<QuotaLedgerEntry>;
    /** Every fragment from every builder — the full surface of what was asked for. */
    allSql(): string;
  }

  interface HarnessOptions {
    readonly users?: User[];
    readonly renderRows?: unknown[];
    readonly renderCount?: number;
    readonly shortlistRows?: unknown[];
    readonly shortlistCount?: number;
  }

  function harness(options: HarnessOptions = {}): Harness {
    const users = createQueryBuilderSpy<User>({ many: options.users ?? [], alias: 'user' });
    const profiles = createQueryBuilderSpy<ConsumerProfile>({ alias: 'profile' });
    const shortlistItems = createQueryBuilderSpy<ShortlistItem>({
      raw: options.shortlistRows ?? [],
      count: options.shortlistCount ?? 0,
      alias: 'item',
    });
    const enquiries = createQueryBuilderSpy<Enquiry>({ alias: 'enquiry' });
    const enquiryItems = createQueryBuilderSpy<EnquiryItem>({
      raw: options.renderRows ?? [],
      count: options.renderCount ?? 0,
      alias: 'item',
    });
    const quotaLedger = createQueryBuilderSpy<QuotaLedgerEntry>({ alias: 'ledger' });

    const repository = <T extends ObjectLiteral>(spy: QueryBuilderSpy<never>): Repository<T> =>
      ({ createQueryBuilder: () => spy.builder }) as unknown as Repository<T>;

    const service = new ConsumerQueryService(
      repository<User>(users as unknown as QueryBuilderSpy<never>),
      repository<ConsumerProfile>(profiles as unknown as QueryBuilderSpy<never>),
      repository<ShortlistItem>(shortlistItems as unknown as QueryBuilderSpy<never>),
      repository<Enquiry>(enquiries as unknown as QueryBuilderSpy<never>),
      repository<EnquiryItem>(enquiryItems as unknown as QueryBuilderSpy<never>),
      repository<QuotaLedgerEntry>(quotaLedger as unknown as QueryBuilderSpy<never>),
    );

    return {
      service,
      users,
      profiles,
      shortlistItems,
      enquiries,
      enquiryItems,
      quotaLedger,
      allSql: () =>
        [users, profiles, shortlistItems, enquiries, enquiryItems, quotaLedger]
          .map((spy) => spy.sql())
          .join(' ║ '),
    };
  }

  function consumer(overrides: Partial<User> = {}): User {
    return buildUser({ id: consumerId, status: UserStatus.ACTIVE, ...overrides });
  }

  const renderQuery: ConsumerRenderQueryDto = {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'DESC',
  };

  const shortlistQuery: ConsumerShortlistQueryDto = {
    page: 1,
    limit: 20,
    sortBy: 'rank',
    sortOrder: 'ASC',
  };

  const listQuery: ConsumerQueryDto = {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'DESC',
  };

  /* ---------------------------------------------------------------------------------------
   * 1. The structural guarantee
   * ------------------------------------------------------------------------------------ */

  describe('the service holds no handle on person_photos', () => {
    it('injects six repositories, and none of them is PersonPhoto', () => {
      const declared = Reflect.getMetadata(
        SELF_DECLARED_DEPS_METADATA,
        ConsumerQueryService,
      ) as ReadonlyArray<{ index: number; param: unknown }>;

      const tokens = declared.map((dependency) => String(dependency.param)).sort();

      expect(tokens).toEqual(
        [
          getRepositoryToken(User),
          getRepositoryToken(ConsumerProfile),
          getRepositoryToken(ShortlistItem),
          getRepositoryToken(Enquiry),
          getRepositoryToken(EnquiryItem),
          getRepositoryToken(QuotaLedgerEntry),
        ]
          .map(String)
          .sort(),
      );

      // The assertion S-10 actually rests on: there is no way in.
      expect(tokens).not.toContain(String(getRepositoryToken(PersonPhoto)));
      expect(tokens).not.toContain(String(getRepositoryToken(TryOnResult)));
    });
  });

  /* ---------------------------------------------------------------------------------------
   * 2. Consumer detail — no photo, anywhere
   * ------------------------------------------------------------------------------------ */

  describe('findConsumerDetail', () => {
    it('names no photo table, column or key prefix in any query it builds', async () => {
      const test = harness({ users: [consumer()] });

      await test.service.findConsumerDetail(consumerId);

      const sql = test.allSql();
      for (const forbidden of PHOTO_FORBIDDEN_FRAGMENTS) {
        expect(sql).not.toContain(forbidden);
      }
      expect(sql).not.toContain('storageKey');
    });

    it('selects only the A-16/A-17 allow-list — no password hash, no 2FA secret', async () => {
      const test = harness({ users: [consumer()] });

      await test.service.findConsumerDetail(consumerId);

      const selected = test.users.argsFor('select').flat().flat();
      expect(selected).toEqual(CONSUMER_USER_COLUMNS.map((column) => `user.${column}`));

      const sql = test.users.sql();
      expect(sql).not.toContain('passwordHash');
    });

    it('scopes every sub-query to the requested consumer', async () => {
      const test = harness({ users: [consumer()] });

      await test.service.findConsumerDetail(consumerId);

      const parameters = [test.enquiries, test.shortlistItems, test.quotaLedger]
        .flatMap((spy) => [...spy.argsFor('where'), ...spy.argsFor('andWhere')])
        .flat()
        .filter((argument): argument is Record<string, unknown> => isPlainObject(argument));

      const scoped = parameters.filter((argument) => 'userIds' in argument || 'userId' in argument);
      expect(scoped.length).toBeGreaterThan(0);
      for (const argument of scoped) {
        const value = argument.userIds ?? argument.userId;
        expect(Array.isArray(value) ? value : [value]).toEqual([consumerId]);
      }
    });

    it('returns null for an id that is not a consumer, without querying anything else', async () => {
      const test = harness({ users: [] });

      await expect(test.service.findConsumerDetail(otherConsumerId)).resolves.toBeNull();
      expect(test.enquiries.calls).toHaveLength(0);
      expect(test.shortlistItems.calls).toHaveLength(0);
    });

    it('restricts the lookup to CONSUMER rows, so an admin id is not addressable', async () => {
      const test = harness({ users: [consumer()] });

      await test.service.findConsumer(consumerId);

      expect(test.users.sql()).toContain('user.role = :role');
      const roleParameter = test.users
        .argsFor('andWhere')
        .flat()
        .find(
          (argument): argument is { role?: unknown } =>
            isPlainObject(argument) && 'role' in argument,
        );
      expect(roleParameter?.role).toBe('CONSUMER');
    });
  });

  /* ---------------------------------------------------------------------------------------
   * 3. Renders — only through an enquiry she submitted
   * ------------------------------------------------------------------------------------ */

  describe('listEnquiryLinkedRenders', () => {
    it('reaches renders only through enquiry_items → enquiries', async () => {
      const test = harness({ renderRows: [], renderCount: 0 });

      await test.service.listEnquiryLinkedRenders(consumerId, renderQuery);

      const joins = test.enquiryItems.argsFor('innerJoin');
      const joinedEntities = joins.map((args) => args[0]);
      expect(joinedEntities).toContain(Enquiry);
      expect(joinedEntities).toContain(TryOnResult);

      // The query starts at enquiry_items — the enquiry link is the way in, not a filter.
      expect(test.enquiryItems.sql()).toContain('item."resultId" IS NOT NULL');
    });

    it('scopes BOTH the enquiry and the render to the same consumer', async () => {
      const test = harness();

      await test.service.listEnquiryLinkedRenders(consumerId, renderQuery);

      const conditions = test.enquiryItems.argsFor('innerJoin').map((args) => String(args[2]));

      const enquiryJoin = conditions.find((condition) => condition.includes('enquiry.id'));
      const resultJoin = conditions.find((condition) => condition.includes('result.id'));

      expect(enquiryJoin).toContain('enquiry."userId" = :userId');
      expect(resultJoin).toContain('result."userId" = :userId');

      const parameters = test.enquiryItems.argsFor('setParameter');
      expect(parameters).toContainEqual(['userId', consumerId]);
    });

    it('returns nothing when she has submitted no enquiry', async () => {
      const test = harness({ renderRows: [], renderCount: 0 });

      const page = await test.service.listEnquiryLinkedRenders(consumerId, renderQuery);

      expect(page.items).toEqual([]);
      expect(page.meta.total).toBe(0);
      expect(page.meta.totalPages).toBe(0);
    });

    it('selects no person-photo column from tryon_results', async () => {
      const test = harness();

      await test.service.listEnquiryLinkedRenders(consumerId, renderQuery);

      const sql = test.enquiryItems.sql();
      for (const forbidden of PHOTO_FORBIDDEN_FRAGMENTS) {
        expect(sql).not.toContain(forbidden);
      }
      // Neither is the photo, but neither is any of an admin's business either.
      expect(sql).not.toContain('personPhotoId');
      expect(sql).not.toContain('personPhotoLabelSnapshot');
    });

    it('reads storageKey only so the service can sign it — and returns the row, not a URL', async () => {
      const test = harness({
        renderCount: 1,
        renderRows: [
          {
            id: 'r1',
            createdAt: '2026-08-01T10:00:00.000Z',
            storageKey: 'renders/c1/abc.png',
            thumbnailKey: null,
            garmentTitleSnapshot: 'Zarrin Bridal Lehenga',
            garmentCategorySnapshot: 'Bridal',
            garmentPriceSnapshot: '185000.00',
            garmentCurrencySnapshot: 'PKR',
            width: '1024',
            height: '1536',
            enquiryId: 'e1',
            enquiryReference: 'ENQ-2026-000137',
          },
        ],
      });

      const page = await test.service.listEnquiryLinkedRenders(consumerId, renderQuery);

      expect(page.items).toHaveLength(1);
      expect(page.items[0].storageKey).toBe('renders/c1/abc.png');
      // pg hands decimals and ints back as strings; the row normalises them.
      expect(page.items[0].garmentPriceSnapshot).toBe(185000);
      expect(page.items[0].width).toBe(1024);
      expect(page.items[0].enquiryReference).toBe('ENQ-2026-000137');
    });
  });

  /* ---------------------------------------------------------------------------------------
   * 4. Shortlist — garments, never renders
   * ------------------------------------------------------------------------------------ */

  describe('listShortlist', () => {
    it('never follows latestResultId, so no unlinked render can leak through it', async () => {
      const test = harness();

      await test.service.listShortlist(consumerId, shortlistQuery);

      const sql = test.shortlistItems.sql();
      expect(sql).not.toContain('latestResultId');
      expect(sql).not.toContain('TryOnResult');
      expect(sql).not.toContain('tryon_results');
      for (const forbidden of PHOTO_FORBIDDEN_FRAGMENTS) {
        expect(sql).not.toContain(forbidden);
      }
    });

    it('excludes NOT_FOR_ME, which exists for A-38 analytics only', async () => {
      const test = harness();

      await test.service.listShortlist(consumerId, shortlistQuery);

      const verdicts = test.shortlistItems
        .argsFor('andWhere')
        .flat()
        .find(
          (argument): argument is { verdicts?: unknown } =>
            isPlainObject(argument) && 'verdicts' in argument,
        );

      expect(verdicts?.verdicts).toEqual(['LOVE_IT', 'MAYBE']);
    });

    it('scopes to the requested consumer', async () => {
      const test = harness();

      await test.service.listShortlist(consumerId, shortlistQuery);

      expect(test.shortlistItems.sql()).toContain('item."userId" = :userId');
      expect(test.shortlistItems.argsFor('where').flat()).toContainEqual({ userId: consumerId });
    });
  });

  /* ---------------------------------------------------------------------------------------
   * 5. A-16 — the list and its derived counts
   * ------------------------------------------------------------------------------------ */

  describe('listConsumers', () => {
    it('merges the three derived counts onto the page, defaulting to zero', async () => {
      const test = harness({ users: [consumer()] });

      const page = await test.service.listConsumers(listQuery);

      expect(page.items).toHaveLength(1);
      expect(page.items[0].aggregates).toEqual({
        generationsThisMonth: 0,
        shortlistSize: 0,
        enquiryCount: 0,
      });
    });

    it('lists consumers only, never admins', async () => {
      const test = harness({ users: [consumer()] });

      await test.service.listConsumers(listQuery);

      expect(test.users.argsFor('where').flat()).toContainEqual({ role: 'CONSUMER' });
    });

    it('builds no query at all when the page is empty', async () => {
      const test = harness({ users: [] });

      const page = await test.service.listConsumers(listQuery);

      expect(page.items).toEqual([]);
      expect(test.quotaLedger.calls).toHaveLength(0);
      expect(test.shortlistItems.calls).toHaveLength(0);
    });

    it('applies the A-16 filters as parameters, never as interpolated SQL', async () => {
      const test = harness({ users: [consumer()] });

      await test.service.listConsumers({
        ...listQuery,
        search: "o'brien",
        status: UserStatus.SUSPENDED,
      });

      const parameters = test.users.argsFor('andWhere').flat();
      expect(parameters).toContainEqual({ search: "%o'brien%" });
      expect(parameters).toContainEqual({ status: UserStatus.SUSPENDED });
      // The value itself never appears in a fragment.
      expect(
        test.users
          .argsFor('andWhere')
          .map((args) => String(args[0]))
          .join(' '),
      ).not.toContain("o'brien");
    });
  });

  /* ---------------------------------------------------------------------------------------
   * 6. Derived, never stored (§4.0 rule 10)
   * ------------------------------------------------------------------------------------ */

  describe('aggregatesFor', () => {
    it('derives generations from the append-only ledger with SUM, not from a column', async () => {
      const test = harness();

      await test.service.aggregatesFor([consumerId]);

      const sql = test.quotaLedger.sql();
      expect(sql).toContain('COALESCE(SUM(-ledger.delta), 0)');
      expect(sql).toContain('ledger.reason = :reason');
      expect(test.quotaLedger.argsFor('andWhere').flat()).toContainEqual({
        reason: 'GENERATION_CONSUMED',
      });
    });

    it('returns an empty map for an empty id list without touching the database', async () => {
      const test = harness();

      await expect(test.service.aggregatesFor([])).resolves.toEqual(new Map());
      expect(test.quotaLedger.calls).toHaveLength(0);
    });
  });
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
