import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import {
  DataSource,
  In,
  Like,
  Repository,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  ForbiddenException,
  GuardChainException,
  NotFoundException,
  OwnershipException,
  paginate,
  paginationSkip,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { runInTransaction } from '@library/database';
import { StorageService } from '@library/storage';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { SettingsService } from '@api/modules/settings';
import { ShortlistService } from '@api/modules/shortlist';
import type { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';
import { User } from '@api/modules/users/entities/user.entity';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { EnquiryItem } from '../entities/enquiry-item.entity';
import { Enquiry } from '../entities/enquiry.entity';
import { EnquiryStatus } from '../enums/enquiry-status.enum';
import { ENQUIRY_CREATED_EVENT, EnquiryCreatedEvent } from '../events/enquiry.events';
import { toConsumerEnquiry, toEnquiryItemResponse } from '../mappers/enquiry.mapper';
import {
  enquiryReferencePrefixFor,
  enquiryReferenceYear,
  formatEnquiryReference,
} from '../utils/enquiry-reference';
import { isUniqueViolation } from '../utils/postgres-errors';

import type { CreateEnquiryDto } from '../dto/create-enquiry.dto';
import type { EnquiryQueryDto } from '../dto/enquiry-query.dto';
import type {
  ConsumerEnquiryResponseDto,
  EnquiryItemResponseDto,
} from '../dto/enquiry-response.dto';

/** The statuses an enquiry is still live in — what `ENQUIRY_ALREADY_OPEN` is about. */
const OPEN_STATUSES: readonly EnquiryStatus[] = [
  EnquiryStatus.NEW,
  EnquiryStatus.CONTACTED,
  EnquiryStatus.IN_DISCUSSION,
];

/**
 * **Submitting and reading her own enquiries — PRD C-3, C-35, C-36; ARCHITECTURE §5.15.**
 *
 * ### The snapshot is the whole point
 *
 * A-21 asks for "shortlisted garments in her rank order with their renders, and
 * per-item notes". §4.24 makes that a copy, not a join: `enquiry_items` carries the
 * title, the SKU, the price, the rank and the note **as they were at submission**. So
 * the admin sees what she actually sent, even after she has reordered her shortlist,
 * emptied it, or changed her mind entirely — and the enquiry still reads a year later
 * when the piece has been repriced or withdrawn. Only `resultId` stays a reference, and
 * it is nullable: if she deletes the render (C-31) the enquiry keeps its text and loses
 * its picture, which is the right way round.
 *
 * ### Two gates before anything is written
 *
 * 1. **`enquiries.enabled`** (A-30). A studio that has closed enquiries is not taking
 *    them, and a queued enquiry nobody reads is worse than a clear refusal.
 * 2. **A verified phone number** (C-3). `PHONE_NOT_VERIFIED` — "Confirm your phone
 *    number to send this enquiry." Checked against the `users` row rather than the
 *    session claim, because a session minted before she verified would otherwise carry
 *    a stale `null` for as long as it lives.
 *
 * ### She sees her own and nothing else
 *
 * Every read is scoped by `userId` before any other filter (§2.9 rule 6). An enquiry
 * belonging to another consumer raises `ENQUIRY_NOT_OWNED`, masked to
 * `ENQUIRY_NOT_FOUND` before it reaches the client (§2.4, S-9, E-7). Internal notes
 * have no shape on any DTO this service returns (A-24).
 */
@Injectable()
export class EnquiriesService {
  constructor(
    @InjectRepository(Enquiry)
    private readonly enquiries: Repository<Enquiry>,
    @InjectRepository(EnquiryItem)
    private readonly items: Repository<EnquiryItem>,
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(ConsumerProfile)
    private readonly profiles: Repository<ConsumerProfile>,
    private readonly shortlist: ShortlistService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * `POST /enquiries` — submit (C-35).
   *
   * Every check runs before the transaction opens, so a refusal costs one round trip
   * and leaves nothing behind. The write itself spans `enquiries` and `enquiry_items`,
   * so it runs inside `runInTransaction` (§2.9 rule 3) — half an enquiry is an admin
   * looking at a message with no pieces attached.
   */
  async submit(user: ICurrentUser, dto: CreateEnquiryDto): Promise<ConsumerEnquiryResponseDto> {
    await this.assertEnquiriesEnabled();

    const account = await this.users.findOne({ where: { id: user.id } });
    if (account === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    const contactPhone = this.requireVerifiedPhone(account);

    const shortlisted = await this.shortlist.rankedItems(user.id);
    if (shortlisted.length === 0) {
      throw new ConflictException(ErrorCode.SHORTLIST_EMPTY);
    }

    const open = await this.enquiries.findOne({
      where: { userId: user.id, status: In([...OPEN_STATUSES]) },
    });
    if (open !== null) {
      throw new ConflictException(ErrorCode.ENQUIRY_ALREADY_OPEN, {
        details: { reference: open.reference, status: open.status },
      });
    }

    const profile = await this.profiles.findOne({ where: { userId: user.id } });
    const garments = await this.garments.find({
      where: { id: In(shortlisted.map((item) => item.garmentId)) },
    });
    const garmentById = new Map(garments.map((garment) => [garment.id, garment]));

    const enquiry = await this.writeWithReference(async (manager, reference) =>
      this.writeEnquiry(manager, {
        reference,
        account,
        contactPhone,
        dto,
        profile,
        shortlisted,
        garmentById,
      }),
    );

    // After the commit (§2.9 rule 3). The A-25 email and in-app copy hang off this.
    this.events.emit(
      ENQUIRY_CREATED_EVENT,
      new EnquiryCreatedEvent({
        enquiryId: enquiry.id,
        reference: enquiry.reference,
        userId: enquiry.userId,
        itemCount: shortlisted.length,
        garmentTitles: shortlisted.map(
          (item) => garmentById.get(item.garmentId)?.title ?? 'A piece from the collection',
        ),
        submittedAt: enquiry.createdAt,
      }),
    );

    return this.findOne(user, enquiry.id);
  }

  /** `GET /enquiries` — her history with current status (C-36). */
  async list(
    user: ICurrentUser,
    query: EnquiryQueryDto,
  ): Promise<IPaginated<ConsumerEnquiryResponseDto>> {
    const where: FindOptionsWhere<Enquiry> = { userId: user.id };
    if (query.status !== undefined) {
      where.status = query.status;
    }

    const [rows, total] = await this.enquiries.findAndCount({
      where,
      // From the `ENQUIRY_SORT_KEYS` allow-list the DTO already narrowed (§2.8), with
      // `createdAt` as the tie-breaker so two enquiries sharing a status cannot swap
      // places between page one and page two.
      order:
        query.sortBy === 'status'
          ? { status: query.sortOrder, createdAt: 'DESC' }
          : { createdAt: query.sortOrder },
      skip: paginationSkip(query),
      take: query.limit,
    });

    const presented = await Promise.all(rows.map((row) => this.present(row, user.id)));
    return paginate(presented, query, total);
  }

  /** `GET /enquiries/:enquiryId` — one of hers. Internal notes are never included (A-24). */
  async findOne(user: ICurrentUser, enquiryId: string): Promise<ConsumerEnquiryResponseDto> {
    const enquiry = await this.loadOwned(user.id, enquiryId);
    return this.present(enquiry, user.id);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async assertEnquiriesEnabled(): Promise<void> {
    if (!(await this.settings.getBoolean(SETTINGS_KEYS.ENQUIRIES_ENABLED))) {
      throw new ForbiddenException(ErrorCode.ENQUIRIES_DISABLED);
    }
  }

  /**
   * C-3 — a verified phone number before an enquiry can be sent.
   *
   * Read from the `users` row rather than from `ICurrentUser`: a session minted before
   * she verified carries the value it had then, and this is the one gate where a stale
   * `null` would refuse a consumer who has already done what was asked.
   *
   * `GuardChainException` rather than a plain forbidden: this is a pre-write predicate
   * in the same family as the try-on chain, and grouping it there is what lets the
   * `tryon.guard_rejected`-style metrics see it.
   */
  private requireVerifiedPhone(account: User): string {
    if (account.phoneVerifiedAt === null || account.phone === null) {
      throw new GuardChainException(ErrorCode.PHONE_NOT_VERIFIED);
    }
    return account.phone;
  }

  /**
   * One enquiry, ownership-checked.
   *
   * Fetched by id alone so the difference between "no such enquiry" and "somebody
   * else's" can be logged; the client is told the same thing either way, because
   * `ENQUIRY_NOT_OWNED` is masked to `ENQUIRY_NOT_FOUND` (§2.4, S-9, E-7).
   */
  private async loadOwned(userId: string, enquiryId: string): Promise<Enquiry> {
    const enquiry = await this.enquiries.findOne({ where: { id: enquiryId } });

    if (enquiry === null) {
      throw new NotFoundException(ErrorCode.ENQUIRY_NOT_FOUND);
    }
    if (enquiry.userId !== userId) {
      throw new OwnershipException(ErrorCode.ENQUIRY_NOT_OWNED);
    }
    return enquiry;
  }

  /**
   * Runs the write, deriving a reference, and retries once on a collision.
   *
   * The sequence is derived by counting inside the transaction and guarded by
   * `UQ_enquiries_reference`. Two submissions racing for the same number produce one
   * commit and one `23505`; the retry re-derives and lands on the next. Exactly one
   * retry — a second collision is not a race any more.
   */
  private async writeWithReference(
    work: (manager: EntityManager, reference: string) => Promise<Enquiry>,
  ): Promise<Enquiry> {
    const attempt = async (): Promise<Enquiry> =>
      runInTransaction(
        this.dataSource,
        async (manager: EntityManager): Promise<Enquiry> =>
          work(manager, await this.nextReference(manager)),
        { label: 'enquiries.submit' },
      );

    try {
      return await attempt();
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return attempt();
    }
  }

  /** `ENQ-2026-000137` — the next number this year (§4.23). */
  private async nextReference(manager: EntityManager): Promise<string> {
    const year = enquiryReferenceYear();
    const used = await manager.getRepository(Enquiry).count({
      where: { reference: Like(`${enquiryReferencePrefixFor(year)}%`) },
      withDeleted: true,
    });
    return formatEnquiryReference(year, used + 1);
  }

  /** The two-table write itself. Runs inside the caller's transaction. */
  private async writeEnquiry(
    manager: EntityManager,
    input: {
      reference: string;
      account: User;
      /** Narrowed by `requireVerifiedPhone` — C-3 has already been satisfied. */
      contactPhone: string;
      dto: CreateEnquiryDto;
      profile: ConsumerProfile | null;
      shortlisted: readonly ShortlistItem[];
      garmentById: ReadonlyMap<string, Garment>;
    },
  ): Promise<Enquiry> {
    const { reference, account, contactPhone, dto, profile, shortlisted, garmentById } = input;

    const enquiries = manager.getRepository(Enquiry);
    const items = manager.getRepository(EnquiryItem);

    // C-35: "with profile details pre-filled". An omitted field means "use my
    // profile", not "leave it blank".
    const eventDate =
      dto.eventDate !== undefined ? new Date(dto.eventDate) : (profile?.eventDate ?? null);

    const total = shortlisted.reduce(
      (sum, item) => sum + (garmentById.get(item.garmentId)?.price ?? 0),
      0,
    );

    const enquiry = await enquiries.save(
      enquiries.create({
        reference,
        userId: account.id,
        message: dto.message,
        status: EnquiryStatus.NEW,
        lostReason: null,
        eventDate,
        eventType: dto.eventType ?? profile?.eventType ?? null,
        budgetBand: dto.budgetBand ?? profile?.budgetBand ?? null,
        // A-21: a snapshot, not a join. The enquiry has to read correctly a year later
        // even if she has since changed her number or closed her account.
        contactName: account.name,
        contactEmail: account.email,
        contactPhone,
        firstRespondedAt: null,
        closedAt: null,
        assignedTo: null,
        totalValueSnapshot: total,
      }),
    );

    const rows = shortlisted.map((item, index) => {
      const garment = garmentById.get(item.garmentId);
      return items.create({
        enquiryId: enquiry.id,
        garmentId: item.garmentId,
        resultId: item.latestResultId,
        // Her order at submission, renumbered contiguously so the snapshot is total
        // even if a rank was somehow sparse.
        rank: index + 1,
        note: item.note,
        garmentTitleSnapshot: garment?.title ?? '',
        garmentSkuSnapshot: garment?.sku ?? '',
        garmentPriceSnapshot: garment?.price ?? null,
      });
    });

    await items.save(rows);
    return enquiry;
  }

  /** One enquiry → her DTO, with her own render thumbnails. */
  private async present(enquiry: Enquiry, userId: string): Promise<ConsumerEnquiryResponseDto> {
    const rows = await this.items.find({
      where: { enquiryId: enquiry.id },
      order: { rank: 'ASC' },
    });

    const resultIds = rows.map((row) => row.resultId).filter((id): id is string => id !== null);

    // Scoped by `userId` as well as by id: these are her renders, and scoping the read
    // is what makes a stale reference incapable of pulling in somebody else's.
    const results =
      resultIds.length === 0
        ? []
        : await this.results.find({ where: { id: In(resultIds), userId } });
    const resultById = new Map(results.map((result) => [result.id, result]));

    const sign = (key: string): string => this.storage.signedUrl(key, userId);

    const items: EnquiryItemResponseDto[] = rows.map((row) => {
      const result = row.resultId === null ? undefined : resultById.get(row.resultId);
      return toEnquiryItemResponse(
        row,
        result === undefined
          ? undefined
          : { storageKey: result.storageKey, thumbnailKey: result.thumbnailKey },
        sign,
      );
    });

    return toConsumerEnquiry(enquiry, items);
  }
}
