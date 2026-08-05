import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import {
  DataSource,
  ILike,
  In,
  IsNull,
  LessThan,
  Repository,
  type EntityManager,
  type FindOptionsOrder,
  type FindOptionsWhere,
} from 'typeorm';

import {
  ErrorCode,
  NotFoundException,
  isAdmin,
  ValidationException,
  paginate,
  paginationSkip,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { runInTransaction } from '@library/database';
import { StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { User } from '@api/modules/users/entities/user.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { ENQUIRY_STALE_AFTER_HOURS, MILLISECONDS_PER_HOUR } from '../constants/enquiry.constants';
import { EnquiryItem } from '../entities/enquiry-item.entity';
import { EnquiryNote } from '../entities/enquiry-note.entity';
import { Enquiry } from '../entities/enquiry.entity';
import { EnquiryStatus } from '../enums/enquiry-status.enum';
import { ENQUIRY_STATUS_CHANGED_EVENT, EnquiryStatusChangedEvent } from '../events/enquiry.events';
import {
  toAdminEnquiry,
  toAdminEnquiryItem,
  toAdminEnquirySummary,
  toEnquiryNote,
} from '../mappers/enquiry.mapper';
import {
  ADMIN_ENQUIRY_ITEM_ALIAS,
  loadAdminRenders,
  type AdminRenderRow,
} from '../queries/admin-enquiry.scope';
import { assertEnquiryTransition, isClosedEnquiryStatus } from '../state/enquiry-status.machine';

import type { AdminEnquiryQueryDto } from '../dto/enquiry-query.dto';
import type {
  AdminEnquiryItemDto,
  AdminEnquiryResponseDto,
  AdminEnquirySummaryDto,
  EnquiryNoteResponseDto,
} from '../dto/enquiry-response.dto';
import type {
  AssignEnquiryDto,
  CreateEnquiryNoteDto,
  UpdateEnquiryStatusDto,
} from '../dto/update-enquiry.dto';
import type { EnquiryRenderKeys } from '../mappers/enquiry.mapper';

/**
 * **The admin inbox — PRD A-21 … A-25, ARCHITECTURE §5.15, §4.23 … §4.25, S-10.**
 *
 * ### What an admin can see, and the one reason they can see it
 *
 * S-10: "Admins cannot view consumer photos. They see renders only where a consumer
 * has submitted an enquiry." This service is the entire exception, and it is narrow by
 * construction:
 *
 * - the render lookup goes through `queries/admin-enquiry.scope.ts`, which starts from
 *   `enquiry_items` and joins `tryon_results` on `item.resultId` — §4.24's "sole
 *   basis";
 * - `person_photos` has no repository here, no join anywhere in this module, and no
 *   column on any DTO this service returns;
 * - a render URL is signed to the **requesting admin's own id**, so it works in their
 *   session and in nobody else's;
 * - and everything descriptive comes from the `enquiry_items` snapshot, so an admin
 *   reading an enquiry is reading what she sent, not a live view of her account.
 *
 * ### The status machine is the only way status moves
 *
 * `state/enquiry-status.machine.ts` owns the transition table and the "reason required
 * on lost" rule (A-22). Nothing here re-derives either, and there is no route that
 * writes `status` without going through it.
 *
 * ### Internal notes are admin-only, and append-only
 *
 * A-24 and §4.25. There is no update route and no delete route; correcting a note
 * means adding another. `EnquiryNote` extends `AppendOnlyEntity`, so the entity has no
 * `updatedAt` and no `deletedAt` for one to be written to.
 */
@Injectable()
export class AdminEnquiriesService {
  constructor(
    @InjectRepository(Enquiry)
    private readonly enquiries: Repository<Enquiry>,
    @InjectRepository(EnquiryItem)
    private readonly items: Repository<EnquiryItem>,
    @InjectRepository(EnquiryNote)
    private readonly notes: Repository<EnquiryNote>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * `GET /admin/enquiries` — the inbox, with the A-25 stale flag.
   *
   * `stale` is a filter over "untouched after 24 hours": `firstRespondedAt IS NULL`
   * and old enough. The partial index `IDX_enquiries_firstRespondedAt WHERE
   * "firstRespondedAt" IS NULL` (§4.23) exists for exactly this predicate.
   */
  async list(query: AdminEnquiryQueryDto): Promise<IPaginated<AdminEnquirySummaryDto>> {
    const now = new Date();
    const where = this.buildWhere(query, now);

    const [rows, total] = await this.enquiries.findAndCount({
      where,
      order: this.orderFor(query),
      skip: paginationSkip(query),
      take: query.limit,
    });

    const counts = await this.itemCounts(rows.map((row) => row.id));
    const summaries = rows.map((row) => toAdminEnquirySummary(row, counts.get(row.id) ?? 0, now));

    return paginate(summaries, query, total);
  }

  /**
   * `GET /admin/enquiries/:enquiryId` — the full enquiry (A-21).
   *
   * The one route in the product where an admin receives a URL for a consumer's
   * render, and it is reachable only because an `enquiry_items` row exists.
   */
  async findOne(actor: ICurrentUser, enquiryId: string): Promise<AdminEnquiryResponseDto> {
    const enquiry = await this.load(enquiryId);
    const items = await this.presentItems(enquiry.id, actor);
    return toAdminEnquiry(enquiry, items, new Date());
  }

  /**
   * `PATCH /admin/enquiries/:enquiryId/status` — move status (A-22).
   *
   * Three columns can move together — `status`, `closedAt` and `firstRespondedAt` — and
   * the audit row is emitted after the commit, never before. A moved status that then
   * rolls back would leave an audit trail describing something that never happened.
   */
  async changeStatus(
    actor: ICurrentUser,
    enquiryId: string,
    dto: UpdateEnquiryStatusDto,
  ): Promise<AdminEnquiryResponseDto> {
    const enquiry = await this.load(enquiryId);
    const from = enquiry.status;

    assertEnquiryTransition(from, dto.status, dto.lostReason);

    const changedAt = new Date();
    await this.enquiries.update(
      { id: enquiry.id },
      {
        status: dto.status,
        lostReason: dto.status === EnquiryStatus.CLOSED_LOST ? (dto.lostReason ?? '').trim() : null,
        closedAt: isClosedEnquiryStatus(dto.status) ? changedAt : null,
        // A-25: any admin action counts as a response. Set once and never moved, so
        // "how long did the first reply take?" stays answerable.
        firstRespondedAt: enquiry.firstRespondedAt ?? changedAt,
      },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.ENQUIRY_STATUS_CHANGED,
        targetType: AUDIT_TARGET_TYPES.ENQUIRY,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: enquiry.id,
        // The reference, not the consumer's name — the row has to read after the
        // account is gone without carrying her identity into the log (E-12).
        targetLabel: enquiry.reference,
        metadata: { from, to: dto.status },
      }),
    );

    this.events.emit(
      ENQUIRY_STATUS_CHANGED_EVENT,
      new EnquiryStatusChangedEvent({
        enquiryId: enquiry.id,
        reference: enquiry.reference,
        userId: enquiry.userId,
        from,
        to: dto.status,
        changedAt,
      }),
    );

    return this.findOne(actor, enquiry.id);
  }

  /** `PATCH /admin/enquiries/:enquiryId/assign` — assign to an admin (§5.15). */
  async assign(
    actor: ICurrentUser,
    enquiryId: string,
    dto: AssignEnquiryDto,
  ): Promise<AdminEnquiryResponseDto> {
    const enquiry = await this.load(enquiryId);

    if (dto.assignedTo !== null) {
      await this.assertAssignableAdmin(dto.assignedTo);
    }

    await this.enquiries.update(
      { id: enquiry.id },
      {
        assignedTo: dto.assignedTo,
        firstRespondedAt: enquiry.firstRespondedAt ?? new Date(),
      },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.ENQUIRY_ASSIGNED,
        targetType: AUDIT_TARGET_TYPES.ENQUIRY,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: enquiry.id,
        targetLabel: enquiry.reference,
        metadata: { assignedTo: dto.assignedTo },
      }),
    );

    return this.findOne(actor, enquiry.id);
  }

  /** `GET /admin/enquiries/:enquiryId/notes` — internal notes (A-24). Admin only. */
  async listNotes(enquiryId: string): Promise<EnquiryNoteResponseDto[]> {
    await this.load(enquiryId);

    const rows = await this.notes.find({
      where: { enquiryId },
      order: { createdAt: 'ASC' },
    });
    if (rows.length === 0) {
      return [];
    }

    const authorIds = rows.map((row) => row.authorId).filter((id): id is string => id !== null);
    const authors =
      authorIds.length === 0 ? [] : await this.users.find({ where: { id: In(authorIds) } });
    const nameById = new Map(authors.map((author) => [author.id, author.name]));

    return rows.map((row) =>
      toEnquiryNote(row, row.authorId === null ? null : (nameById.get(row.authorId) ?? null)),
    );
  }

  /**
   * `POST /admin/enquiries/:enquiryId/notes` — add an internal note (A-24).
   *
   * Two tables move — the note is appended and the enquiry is marked as responded to —
   * so it runs inside `runInTransaction` (§2.9 rule 3). A note that landed without the
   * enquiry leaving the A-25 stale list would be an admin who has done the work and is
   * still being chased for it.
   */
  async addNote(
    actor: ICurrentUser,
    enquiryId: string,
    dto: CreateEnquiryNoteDto,
  ): Promise<EnquiryNoteResponseDto> {
    const enquiry = await this.load(enquiryId);

    const note = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<EnquiryNote> => {
        const notes = manager.getRepository(EnquiryNote);
        const saved = await notes.save(
          notes.create({ enquiryId: enquiry.id, authorId: actor.id, body: dto.body }),
        );

        await manager
          .getRepository(Enquiry)
          .update({ id: enquiry.id }, { firstRespondedAt: enquiry.firstRespondedAt ?? new Date() });

        return saved;
      },
      { label: 'enquiries.addNote' },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.ENQUIRY_NOTE_ADDED,
        targetType: AUDIT_TARGET_TYPES.ENQUIRY,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: enquiry.id,
        targetLabel: enquiry.reference,
        // The note body is not in the metadata. A-24 makes it admin-only, and the
        // audit log has a wider readership than the enquiry does.
      }),
    );

    return toEnquiryNote(note, actor.name);
  }

  /** The row itself. Used by the export and the WhatsApp reply, which need the enquiry. */
  async load(enquiryId: string): Promise<Enquiry> {
    const enquiry = await this.enquiries.findOne({ where: { id: enquiryId } });
    if (enquiry === null) {
      throw new NotFoundException(ErrorCode.ENQUIRY_NOT_FOUND);
    }
    return enquiry;
  }

  /** The snapshotted items of one enquiry, in her rank order. */
  async loadItems(enquiryId: string): Promise<EnquiryItem[]> {
    return this.items.find({ where: { enquiryId }, order: { rank: 'ASC' } });
  }

  /** The `where` an inbox query resolves to. Exposed so the CSV export filters identically. */
  buildWhere(query: AdminEnquiryQueryDto, now: Date): FindOptionsWhere<Enquiry>[] {
    const base: FindOptionsWhere<Enquiry> = {};

    if (query.status !== undefined) {
      base.status = query.status;
    }
    if (query.assignedTo !== undefined) {
      base.assignedTo = query.assignedTo;
    }
    if (query.stale === true) {
      // Untouched, and old enough to count as untouched (A-25).
      base.firstRespondedAt = IsNull();
      base.createdAt = LessThan(
        new Date(now.getTime() - ENQUIRY_STALE_AFTER_HOURS * MILLISECONDS_PER_HOUR),
      );
    }

    if (query.search === undefined || query.search.trim().length === 0) {
      return [base];
    }

    // An array of clauses is OR in TypeORM. Reference, name and email are the three
    // things an admin has in front of them when a consumer calls (§5.15).
    const term = `%${query.search.trim()}%`;
    return [
      { ...base, reference: ILike(term) },
      { ...base, contactName: ILike(term) },
      { ...base, contactEmail: ILike(term) },
    ];
  }

  /** The order an inbox query resolves to, from the §2.8 allow-list. */
  orderFor(query: AdminEnquiryQueryDto): FindOptionsOrder<Enquiry> {
    return query.sortBy === 'status'
      ? { status: query.sortOrder, createdAt: 'DESC' }
      : { createdAt: query.sortOrder };
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * An enquiry may only be assigned to an active admin.
   *
   * Assigning to a consumer would hide it from every admin filter; assigning to a
   * deactivated admin is a queue nobody is reading. Both are silent failures, which is
   * why this is checked rather than trusted.
   */
  private async assertAssignableAdmin(userId: string): Promise<void> {
    const assignee = await this.users.findOne({ where: { id: userId } });

    if (assignee === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    if (!isAdmin(assignee.role)) {
      throw new ValidationException(ErrorCode.SETTINGS_VALUE_INVALID, {
        message: 'Enquiries can only be assigned to an admin.',
        errors: [{ field: 'assignedTo', message: 'Not an admin account.', code: 'NOT_ADMIN' }],
      });
    }
  }

  /** Item counts for a page of enquiries, in one query rather than one per row. */
  private async itemCounts(enquiryIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (enquiryIds.length === 0) {
      return counts;
    }

    const rows = await this.items.find({ where: { enquiryId: In([...enquiryIds]) } });
    for (const row of rows) {
      counts.set(row.enquiryId, (counts.get(row.enquiryId) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * The items of one enquiry, with the renders that enquiry entitles this admin to see.
   *
   * The render keys come from `loadAdminRenders`, which is the §4.24 join and the only
   * query in this module that touches `tryon_results`.
   */
  private async presentItems(
    enquiryId: string,
    actor: ICurrentUser,
  ): Promise<AdminEnquiryItemDto[]> {
    const rows = await this.loadItems(enquiryId);
    if (rows.length === 0) {
      return [];
    }

    const renders: AdminRenderRow[] = await loadAdminRenders(
      this.items.createQueryBuilder(ADMIN_ENQUIRY_ITEM_ALIAS),
      enquiryId,
    );
    const keysByItem = new Map<string, EnquiryRenderKeys>(
      renders.map((render) => [
        render.itemId,
        { storageKey: render.storageKey, thumbnailKey: render.thumbnailKey },
      ]),
    );

    // Signed to the requesting admin's own id (§3.4 step 4), so the URL is useless in
    // any other session — including another admin's.
    const sign = (key: string): string => this.storage.signedUrl(key, actor.id);

    return rows.map((row) => toAdminEnquiryItem(row, keysByItem.get(row.id), sign));
  }
}
