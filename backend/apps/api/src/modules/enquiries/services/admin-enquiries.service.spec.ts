import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { AppException, ErrorCode, Role } from '@library/common';
import type { ICurrentUser } from '@library/common';
import { StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, type AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { User } from '@api/modules/users/entities/user.entity';
import {
  attachQueryBuilder,
  createFakeEntityManager,
  createQueryBuilderSpy,
  createTransactionalDataSource,
} from '@api/modules/users/testing/query-doubles';
import { sessionFor } from '@api/modules/users/testing/route-authorisation';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

import {
  buildAdminUser,
  buildContactedEnquiry,
  buildEnquiry,
  buildStaleEnquiry,
  buildUser,
} from '../../../../test/factories';
import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';
import { freezeClock, restoreClock } from '../../../../test/setup/time';
import { EnquiryItem } from '../entities/enquiry-item.entity';
import { EnquiryNote } from '../entities/enquiry-note.entity';
import { Enquiry } from '../entities/enquiry.entity';
import { EnquiryStatus } from '../enums/enquiry-status.enum';
import { ENQUIRY_STATUS_CHANGED_EVENT } from '../events/enquiry.events';
import { buildEnquiryItem, buildEnquiryNote } from '../testing/enquiry-fixtures';

import { AdminEnquiriesService } from './admin-enquiries.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { AdminRenderRow } from '../queries/admin-enquiry.scope';

/**
 * **The admin inbox — A-21 … A-25, and S-10's one exception.**
 *
 * The status machine has its own exhaustive spec; what is proved here is that the
 * *service* has no way round it, that the columns which move together do move together,
 * and that a render URL reaches an admin scoped to their own session and only because
 * an `enquiry_items` row exists.
 */
describe('AdminEnquiriesService', () => {
  const admin: ICurrentUser = sessionFor(Role.ADMIN);

  interface Harness {
    service: AdminEnquiriesService;
    enquiries: InMemoryRepository<Enquiry>;
    notes: InMemoryRepository<EnquiryNote>;
    events: jest.Mocked<EventEmitter2>;
    signedKeys: string[];
    close: () => Promise<void>;
  }

  async function arrange(
    options: {
      enquiries?: readonly Enquiry[];
      items?: readonly EnquiryItem[];
      notes?: readonly EnquiryNote[];
      users?: readonly User[];
      renders?: readonly AdminRenderRow[];
    } = {},
  ): Promise<Harness> {
    const enquiries = createInMemoryRepository<Enquiry>({
      rows: options.enquiries ?? [],
      create: (partial) => buildEnquiry(partial),
    });
    const items = createInMemoryRepository<EnquiryItem>({ rows: options.items ?? [] });
    const notes = createInMemoryRepository<EnquiryNote>({
      rows: options.notes ?? [],
      create: (partial) => buildEnquiryNote(partial),
    });
    const users = createInMemoryRepository<User>({ rows: options.users ?? [] });

    attachQueryBuilder(items, createQueryBuilderSpy<EnquiryItem>({ raw: options.renders ?? [] }));

    const manager = createFakeEntityManager(
      new Map<new (...args: never[]) => object, unknown>([
        [Enquiry, enquiries],
        [EnquiryItem, items],
        [EnquiryNote, notes],
      ]),
    );
    const { dataSource } = createTransactionalDataSource(manager);

    const signedKeys: string[] = [];
    const storage = createMock<StorageService>(['signedUrl']);
    storage.signedUrl.mockImplementation((key: string, subject?: string) => {
      signedKeys.push(key);
      return `https://api.test/files/${key}?sub=${subject ?? ''}`;
    });

    const events = createMock<EventEmitter2>(['emit']);

    const harness = await createTestingModule({
      providers: [AdminEnquiriesService],
      overrides: [
        { token: getRepositoryToken(Enquiry), value: enquiries },
        { token: getRepositoryToken(EnquiryItem), value: items },
        { token: getRepositoryToken(EnquiryNote), value: notes },
        { token: getRepositoryToken(User), value: users },
        { token: StorageService, value: storage },
        { token: EventEmitter2, value: events },
        { token: DataSource, value: dataSource },
      ],
    });

    return {
      service: harness.get<AdminEnquiriesService>(AdminEnquiriesService),
      enquiries,
      notes,
      events,
      signedKeys,
      close: harness.close,
    };
  }

  async function errorCodeOf(work: Promise<unknown>): Promise<ErrorCode | undefined> {
    try {
      await work;
      return undefined;
    } catch (error) {
      if (error instanceof AppException) {
        return error.errorCode;
      }
      throw error;
    }
  }

  function auditActions(harness: Harness): string[] {
    return harness.events.emit.mock.calls
      .filter(([name]) => name === AUDIT_RECORD_EVENT)
      .map(([, event]) => (event as AuditRecordEvent).input.action);
  }

  const query = {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'DESC' as const,
  };

  beforeEach(() => freezeClock());
  afterEach(() => restoreClock());

  /* --------------------------------------------------------------------------------------- */

  describe('A-22 — the service has no way round the state machine', () => {
    it('moves a valid transition and records when it closed', async () => {
      const enquiry = buildEnquiry({ status: EnquiryStatus.IN_DISCUSSION });
      const harness = await arrange({ enquiries: [enquiry] });

      const updated = await harness.service.changeStatus(admin, enquiry.id, {
        status: EnquiryStatus.CLOSED_WON,
      });

      expect(updated.status).toBe(EnquiryStatus.CLOSED_WON);
      expect(harness.enquiries.$rows[0]?.closedAt).not.toBeNull();

      await harness.close();
    });

    it('refuses an invalid one and changes nothing', async () => {
      const enquiry = buildEnquiry({ status: EnquiryStatus.NEW });
      const harness = await arrange({ enquiries: [enquiry] });

      expect(
        await errorCodeOf(
          harness.service.changeStatus(admin, enquiry.id, { status: EnquiryStatus.CLOSED_WON }),
        ),
      ).toBe(ErrorCode.INVALID_ENQUIRY_TRANSITION);

      expect(harness.enquiries.$rows[0]?.status).toBe(EnquiryStatus.NEW);
      expect(auditActions(harness)).toEqual([]);

      await harness.close();
    });

    it('refuses a lost close with no reason, and changes nothing', async () => {
      const enquiry = buildEnquiry({ status: EnquiryStatus.NEW });
      const harness = await arrange({ enquiries: [enquiry] });

      expect(
        await errorCodeOf(
          harness.service.changeStatus(admin, enquiry.id, { status: EnquiryStatus.CLOSED_LOST }),
        ),
      ).toBe(ErrorCode.ENQUIRY_LOST_REASON_REQUIRED);

      expect(harness.enquiries.$rows[0]?.status).toBe(EnquiryStatus.NEW);

      await harness.close();
    });

    it('stores the reason on a lost close, and clears it on any other', async () => {
      const enquiry = buildEnquiry({ status: EnquiryStatus.NEW });
      const harness = await arrange({ enquiries: [enquiry] });

      await harness.service.changeStatus(admin, enquiry.id, {
        status: EnquiryStatus.CLOSED_LOST,
        lostReason: 'Chose a different studio.',
      });
      expect(harness.enquiries.$rows[0]?.lostReason).toBe('Chose a different studio.');

      const contacted = buildEnquiry({ status: EnquiryStatus.NEW, lostReason: 'stale value' });
      const second = await arrange({ enquiries: [contacted] });
      await second.service.changeStatus(admin, contacted.id, {
        status: EnquiryStatus.CONTACTED,
      });
      expect(second.enquiries.$rows[0]?.lostReason).toBeNull();

      await harness.close();
      await second.close();
    });
  });

  describe('A-25 — first response, and the stale flag', () => {
    it('marks the first response and never moves it again', async () => {
      const enquiry = buildEnquiry({ status: EnquiryStatus.NEW, firstRespondedAt: null });
      const harness = await arrange({ enquiries: [enquiry] });

      await harness.service.changeStatus(admin, enquiry.id, { status: EnquiryStatus.CONTACTED });
      const firstResponse = harness.enquiries.$rows[0]?.firstRespondedAt;
      expect(firstResponse).not.toBeNull();

      await harness.service.changeStatus(admin, enquiry.id, {
        status: EnquiryStatus.IN_DISCUSSION,
      });
      expect(harness.enquiries.$rows[0]?.firstRespondedAt).toEqual(firstResponse);

      await harness.close();
    });

    it('flags an untouched enquiry older than 24 hours', async () => {
      const stale = buildStaleEnquiry();
      const answered = buildContactedEnquiry();
      const harness = await arrange({ enquiries: [stale, answered] });

      const page = await harness.service.list(query);

      expect(page.items.find((row) => row.id === stale.id)?.isStale).toBe(true);
      expect(page.items.find((row) => row.id === answered.id)?.isStale).toBe(false);

      await harness.close();
    });

    it('filters the inbox down to the stale ones', async () => {
      const stale = buildStaleEnquiry();
      const answered = buildContactedEnquiry();
      const harness = await arrange({ enquiries: [stale, answered] });

      const page = await harness.service.list({ ...query, stale: true });

      expect(page.items.map((row) => row.id)).toEqual([stale.id]);

      await harness.close();
    });
  });

  describe('A-3 — the audit trail', () => {
    it('records a status change with the move it made', async () => {
      const enquiry = buildEnquiry({ status: EnquiryStatus.NEW });
      const harness = await arrange({ enquiries: [enquiry] });

      await harness.service.changeStatus(admin, enquiry.id, { status: EnquiryStatus.CONTACTED });

      const audit = harness.events.emit.mock.calls
        .filter(([name]) => name === AUDIT_RECORD_EVENT)
        .map(([, event]) => (event as AuditRecordEvent).input)[0];

      expect(audit).toMatchObject({
        action: AUDIT_ACTIONS.ENQUIRY_STATUS_CHANGED,
        actorId: admin.id,
        targetId: enquiry.id,
        targetLabel: enquiry.reference,
        metadata: { from: EnquiryStatus.NEW, to: EnquiryStatus.CONTACTED },
      });
      // The reference, not her name — the row outlives the account (E-12).
      expect(JSON.stringify(audit)).not.toContain(enquiry.contactName);

      await harness.close();
    });

    it('tells the consumer where things stand', async () => {
      const enquiry = buildEnquiry({ status: EnquiryStatus.NEW });
      const harness = await arrange({ enquiries: [enquiry] });

      await harness.service.changeStatus(admin, enquiry.id, { status: EnquiryStatus.CONTACTED });

      expect(harness.events.emit).toHaveBeenCalledWith(
        ENQUIRY_STATUS_CHANGED_EVENT,
        expect.anything(),
      );

      await harness.close();
    });
  });

  describe('A-24 — internal notes', () => {
    it('appends a note and takes the enquiry off the stale list', async () => {
      const enquiry = buildEnquiry({ firstRespondedAt: null });
      const harness = await arrange({
        enquiries: [enquiry],
        users: [buildAdminUser({ id: admin.id })],
      });

      const note = await harness.service.addNote(admin, enquiry.id, { body: 'Called, no answer.' });

      expect(note.body).toBe('Called, no answer.');
      expect(harness.notes.$rows).toHaveLength(1);
      expect(harness.enquiries.$rows[0]?.firstRespondedAt).not.toBeNull();
      expect(auditActions(harness)).toEqual([AUDIT_ACTIONS.ENQUIRY_NOTE_ADDED]);

      await harness.close();
    });

    it('never puts the note body in the audit log', async () => {
      const enquiry = buildEnquiry();
      const harness = await arrange({ enquiries: [enquiry] });

      await harness.service.addNote(admin, enquiry.id, { body: 'Discount authorised to 15%.' });

      const audits = harness.events.emit.mock.calls
        .filter(([name]) => name === AUDIT_RECORD_EVENT)
        .map(([, event]) => (event as AuditRecordEvent).input);

      expect(JSON.stringify(audits)).not.toContain('Discount authorised');

      await harness.close();
    });

    it('lists notes oldest first, with their authors', async () => {
      const enquiry = buildEnquiry();
      const author = buildAdminUser({ name: 'Test Admin' });
      const harness = await arrange({
        enquiries: [enquiry],
        users: [author],
        notes: [buildEnquiryNote({ enquiryId: enquiry.id, authorId: author.id, body: 'First' })],
      });

      const notes = await harness.service.listNotes(enquiry.id);

      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ body: 'First', authorName: 'Test Admin' });

      await harness.close();
    });

    it('exposes no way to change or remove one (§4.25)', () => {
      // Append-only is a property of the surface, not of a runtime check: there is
      // nothing to call.
      const surface = Object.getOwnPropertyNames(AdminEnquiriesService.prototype);

      expect(surface).not.toContain('updateNote');
      expect(surface).not.toContain('removeNote');
      expect(surface).not.toContain('deleteNote');
    });
  });

  describe('assignment', () => {
    it('assigns to an admin', async () => {
      const enquiry = buildEnquiry();
      const assignee = buildAdminUser();
      const harness = await arrange({ enquiries: [enquiry], users: [assignee] });

      const updated = await harness.service.assign(admin, enquiry.id, { assignedTo: assignee.id });

      expect(updated.assignedTo).toBe(assignee.id);
      expect(auditActions(harness)).toEqual([AUDIT_ACTIONS.ENQUIRY_ASSIGNED]);

      await harness.close();
    });

    it('refuses to assign to a consumer — the enquiry would vanish from every admin filter', async () => {
      const enquiry = buildEnquiry();
      const consumer = buildUser();
      const harness = await arrange({ enquiries: [enquiry], users: [consumer] });

      expect(
        await errorCodeOf(harness.service.assign(admin, enquiry.id, { assignedTo: consumer.id })),
      ).toBe(ErrorCode.SETTINGS_VALUE_INVALID);

      await harness.close();
    });

    it('unassigns on null', async () => {
      const enquiry = buildEnquiry({ assignedTo: admin.id });
      const harness = await arrange({ enquiries: [enquiry] });

      expect(
        (await harness.service.assign(admin, enquiry.id, { assignedTo: null })).assignedTo,
      ).toBeNull();

      await harness.close();
    });
  });

  describe('S-10 — the render an enquiry entitles an admin to', () => {
    it('signs it to the requesting admin, not to the consumer', async () => {
      const enquiry = buildEnquiry();
      const item = buildEnquiryItem({ enquiryId: enquiry.id, rank: 1 });
      const harness = await arrange({
        enquiries: [enquiry],
        items: [item],
        renders: [
          {
            itemId: item.id,
            storageKey: 'renders/consumer/abc.png',
            thumbnailKey: 'thumbnails/render/abc-320.webp',
          },
        ],
      });

      const detail = await harness.service.findOne(admin, enquiry.id);

      expect(detail.items[0]?.renderUrl).toContain(`sub=${admin.id}`);
      // A token scoped to the consumer would not verify in an admin's session (§3.4).
      expect(detail.items[0]?.renderUrl).not.toContain(enquiry.userId);

      await harness.close();
    });

    it('reads the piece from the snapshot, never from a live garment', async () => {
      const enquiry = buildEnquiry();
      const item = buildEnquiryItem({
        enquiryId: enquiry.id,
        rank: 1,
        garmentTitleSnapshot: 'Zarrin Bridal Lehenga',
        garmentPriceSnapshot: 185_000,
      });
      const harness = await arrange({ enquiries: [enquiry], items: [item] });

      const detail = await harness.service.findOne(admin, enquiry.id);

      expect(detail.items[0]).toMatchObject({
        title: 'Zarrin Bridal Lehenga',
        price: 185_000,
      });

      await harness.close();
    });

    it('shows no image for a render the consumer has since deleted (C-31)', async () => {
      const enquiry = buildEnquiry();
      const item = buildEnquiryItem({ enquiryId: enquiry.id, rank: 1, resultId: null });
      const harness = await arrange({ enquiries: [enquiry], items: [item], renders: [] });

      const detail = await harness.service.findOne(admin, enquiry.id);

      expect(detail.items[0]?.renderUrl).toBeNull();
      expect(detail.items[0]?.title).toBe(item.garmentTitleSnapshot);
      expect(harness.signedKeys).toEqual([]);

      await harness.close();
    });
  });

  it('answers NOT_FOUND for an enquiry that does not exist', async () => {
    const harness = await arrange();

    expect(
      await errorCodeOf(harness.service.findOne(admin, 'f0000000-0000-4000-8000-00000000000f')),
    ).toBe(ErrorCode.ENQUIRY_NOT_FOUND);

    await harness.close();
  });
});
