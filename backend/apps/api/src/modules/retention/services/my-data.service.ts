import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ErrorCode, NotFoundException, type ICurrentUser } from '@library/common';
import { StorageService } from '@library/storage';

import { Consent } from '@api/modules/consents/entities/consent.entity';
import { PolicyService } from '@api/modules/consents/services/policy.service';
import { EnquiryItem } from '@api/modules/enquiries/entities/enquiry-item.entity';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShareLink } from '@api/modules/share/entities/share-link.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { MY_DATA_PAGE_SIZE } from '../constants/retention.constants';
import {
  MyDataConsentDto,
  MyDataEnquiryDto,
  MyDataPhotoDto,
  MyDataProfileDto,
  MyDataRenderDto,
  MyDataResponseDto,
  MyDataSectionDto,
  MyDataShareLinkDto,
  MyDataShortlistItemDto,
} from '../dto/my-data-response.dto';

/**
 * **C-37 — "a single screen showing everything stored about her".**
 *
 * > "…profile, photos, renders, shortlists, enquiries, and the consent she granted with
 * > its date."
 *
 * ### Live, never a stored snapshot
 *
 * Every section is read at request time. A cached copy of "everything stored about her"
 * would itself be a store of everything about her — a second place her data lives, with
 * its own retention question and its own deletion path. The screen is expensive enough
 * to be worth caching and important enough not to be.
 *
 * ### Capped, and honest about it
 *
 * "A single screen" is the requirement. Each list stops at {@link MY_DATA_PAGE_SIZE} and
 * reports its true total beside the count shown, so a consumer with four hundred renders
 * is told she has four hundred rather than being quietly shown a hundred. C-39's export
 * is where she gets all of them, and the two requirements sit next to each other in the
 * PRD for that reason.
 *
 * ### Ownership is a predicate, never a filter
 *
 * Every query below carries `userId` from the session in its `WHERE` clause (§9.2).
 * There is no method here that takes a user id, so there is no argument any caller could
 * pass that would widen a read to another account.
 */
@Injectable()
export class MyDataService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(PersonPhoto)
    private readonly photos: Repository<PersonPhoto>,
    @InjectRepository(TryOnResult)
    private readonly renders: Repository<TryOnResult>,
    @InjectRepository(ShortlistItem)
    private readonly shortlist: Repository<ShortlistItem>,
    @InjectRepository(Enquiry)
    private readonly enquiries: Repository<Enquiry>,
    @InjectRepository(EnquiryItem)
    private readonly enquiryItems: Repository<EnquiryItem>,
    @InjectRepository(ShareLink)
    private readonly shareLinks: Repository<ShareLink>,
    @InjectRepository(Consent)
    private readonly consents: Repository<Consent>,
    private readonly storage: StorageService,
    private readonly policy: PolicyService,
  ) {}

  /** `GET /me/data` (C-37, §5.2). */
  async myData(user: ICurrentUser): Promise<MyDataResponseDto> {
    const account = await this.users.findOne({ where: { id: user.id } });
    if (account === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    const [photos, renders, shortlist, enquiries, shareLinks, consent] = await Promise.all([
      this.photoSection(user.id),
      this.renderSection(user.id),
      this.shortlistSection(user.id),
      this.enquirySection(user.id),
      this.shareLinkSection(user.id),
      this.currentConsent(user.id),
    ]);

    const dto = new MyDataResponseDto();
    dto.profile = this.profileOf(account);
    dto.photos = photos;
    dto.renders = renders;
    dto.shortlist = shortlist;
    dto.enquiries = enquiries;
    dto.shareLinks = shareLinks;
    dto.consent = consent;
    dto.generatedAt = new Date();
    return dto;
  }

  /* -----------------------------------------------------------------------------------------
   * Sections
   * -------------------------------------------------------------------------------------- */

  private profileOf(account: User): MyDataProfileDto {
    const dto = new MyDataProfileDto();
    dto.id = account.id;
    dto.name = account.name;
    dto.email = account.email;
    dto.phone = account.phone;
    dto.locale = account.locale;
    dto.createdAt = account.createdAt;
    dto.emailVerifiedAt = account.emailVerifiedAt;
    dto.phoneVerifiedAt = account.phoneVerifiedAt;
    dto.lastActiveAt = account.lastActiveAt;
    dto.deletionRequestedAt = account.deletionRequestedAt;
    return dto;
  }

  private async photoSection(userId: string): Promise<MyDataSectionDto<MyDataPhotoDto>> {
    const [rows, total] = await this.photos.findAndCount({
      where: { userId },
      order: { uploadedAt: 'DESC' },
      take: MY_DATA_PAGE_SIZE,
    });

    return section(
      rows.map((photo) => {
        const dto = new MyDataPhotoDto();
        dto.id = photo.id;
        dto.label = photo.label;
        dto.isActive = photo.isActive;
        dto.uploadedAt = photo.uploadedAt;
        dto.purgeAfter = photo.purgeAfter;
        // Scoped to her own id (§3.4). The inverse of the moderation queue: this
        // photograph is hers, so she gets the original rather than a blur.
        dto.url = this.storage.signedUrl(photo.storageKey, photo.userId);
        return dto;
      }),
      total,
    );
  }

  private async renderSection(userId: string): Promise<MyDataSectionDto<MyDataRenderDto>> {
    const [rows, total] = await this.renders.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: MY_DATA_PAGE_SIZE,
    });

    return section(
      rows.map((render) => {
        const dto = new MyDataRenderDto();
        dto.id = render.id;
        // The snapshots, not a join: C-29 keeps a render readable after its garment is
        // gone, and a screen about her data should not disappear because a buyer
        // archived a dress.
        dto.garmentTitle = render.garmentTitleSnapshot;
        dto.garmentCategory = render.garmentCategorySnapshot;
        dto.createdAt = render.createdAt;
        dto.marketingOptInAt = render.marketingOptInAt;
        dto.url = this.storage.signedUrl(render.storageKey, userId);
        return dto;
      }),
      total,
    );
  }

  private async shortlistSection(
    userId: string,
  ): Promise<MyDataSectionDto<MyDataShortlistItemDto>> {
    const [rows, total] = await this.shortlist.findAndCount({
      where: { userId },
      order: { verdictAt: 'DESC' },
      take: MY_DATA_PAGE_SIZE,
    });

    return section(
      rows.map((item) => {
        const dto = new MyDataShortlistItemDto();
        dto.id = item.id;
        dto.verdict = item.verdict;
        dto.rejectReason = item.rejectReason;
        dto.note = item.note;
        dto.verdictAt = item.verdictAt;
        return dto;
      }),
      total,
    );
  }

  private async enquirySection(userId: string): Promise<MyDataSectionDto<MyDataEnquiryDto>> {
    const [rows, total] = await this.enquiries.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: MY_DATA_PAGE_SIZE,
    });

    // One grouped count for the page rather than one query per enquiry.
    const counts = await this.itemCountsFor(rows.map((enquiry) => enquiry.id));

    return section(
      rows.map((enquiry) => {
        const dto = new MyDataEnquiryDto();
        dto.reference = enquiry.reference;
        dto.status = enquiry.status;
        dto.itemCount = counts.get(enquiry.id) ?? 0;
        dto.createdAt = enquiry.createdAt;
        return dto;
      }),
      total,
    );
  }

  private async shareLinkSection(userId: string): Promise<MyDataSectionDto<MyDataShareLinkDto>> {
    const [rows, total] = await this.shareLinks.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: MY_DATA_PAGE_SIZE,
    });

    return section(
      rows.map((link) => {
        const dto = new MyDataShareLinkDto();
        dto.id = link.id;
        dto.label = link.label;
        dto.expiresAt = link.expiresAt;
        dto.revokedAt = link.revokedAt;
        dto.viewCount = link.viewCount;
        // `tokenHash` is deliberately absent. It is the credential the link is built
        // from, and a privacy screen is not a place to re-issue one.
        return dto;
      }),
      total,
    );
  }

  /**
   * C-37 names this explicitly: "the consent she granted **with its date**".
   *
   * `consents` is append-only (§4.11) and re-consent appends, so the current grant is
   * the most recent row. `current` is derived by comparing its policy version with the
   * live one — the same comparison that produces `CONSENT_STALE` on the try-on path
   * (C-12), so the screen and the guard chain cannot disagree about whether she is up
   * to date.
   */
  private async currentConsent(userId: string): Promise<MyDataConsentDto | null> {
    const consent = await this.consents.findOne({
      where: { userId },
      order: { grantedAt: 'DESC' },
    });

    if (consent === null) {
      return null;
    }

    const dto = new MyDataConsentDto();
    dto.policyVersion = consent.policyVersion;
    dto.grantedAt = consent.grantedAt;
    dto.locale = consent.locale;
    dto.current = await this.isCurrentPolicy(consent.policyVersionId);
    return dto;
  }

  private async isCurrentPolicy(policyVersionId: string): Promise<boolean> {
    try {
      const current = await this.policy.currentPolicy();
      return current.id === policyVersionId;
    } catch {
      // No published policy at all. Her grant is not stale — there is nothing newer.
      return true;
    }
  }

  private async itemCountsFor(enquiryIds: readonly string[]): Promise<Map<string, number>> {
    if (enquiryIds.length === 0) {
      return new Map();
    }

    const rows = await this.enquiryItems
      .createQueryBuilder('item')
      .select('item.enquiryId', 'enquiryId')
      .addSelect('COUNT(*)', 'count')
      .where('item.enquiryId IN (:...ids)', { ids: enquiryIds })
      .andWhere('item.deletedAt IS NULL')
      .groupBy('item.enquiryId')
      .getRawMany<{ enquiryId: string; count: string }>();

    return new Map(rows.map((row) => [row.enquiryId, Number(row.count)]));
  }
}

/** Wraps a capped list with its true total (C-37 — "one screen", honestly labelled). */
function section<T>(items: T[], total: number): MyDataSectionDto<T> {
  const dto = new MyDataSectionDto<T>();
  dto.items = items;
  dto.shown = items.length;
  dto.total = total;
  return dto;
}
