import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, Repository } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  ForbiddenException,
  NotFoundException,
  OwnershipException,
  type ICurrentUser,
} from '@library/common';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { SettingsService } from '@api/modules/settings';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import {
  MAX_ACTIVE_SHARE_LINKS,
  MILLISECONDS_PER_DAY,
  SHARE_LINK_TTL_DAYS,
} from '../constants/share.constants';
import { ShareLink } from '../entities/share-link.entity';
import { Vote } from '../entities/vote.entity';
import { isLinkActive, toShareLinkResponse, toShareLinkVote } from '../mappers/share.mapper';

import { ShareTokenService } from './share-token.service';

import type { CreateShareLinkDto } from '../dto/create-share-link.dto';
import type { ShareLinkResponseDto } from '../dto/share-link-response.dto';
import type { ShareLinkVoteDto } from '../dto/vote-response.dto';

/**
 * **The owner's side of sharing — PRD C-33, C-34, A-30; ARCHITECTURE §5.14, §4.21.**
 *
 * This is where a link is minted and, more importantly, where it is taken away. C-34
 * gives her two guarantees and both are absolute: every link expires after 30 days,
 * and she can revoke any of them at any time. Revocation is a single column and it
 * takes effect on the next request — there is no cache to wait for and no snapshot
 * that outlives it, because §4.21 resolves the live shortlist rather than storing a
 * copy of it.
 *
 * She is told which of "revoked" and "expired" applies to each of her links, because
 * it is her link and the two call for different actions. A recipient is told neither:
 * `PublicShareService` answers `SHARE_LINK_NOT_FOUND` for revoked, expired and
 * never-existed alike.
 */
@Injectable()
export class ShareLinksService {
  constructor(
    @InjectRepository(ShareLink)
    private readonly links: Repository<ShareLink>,
    @InjectRepository(Vote)
    private readonly votes: Repository<Vote>,
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    private readonly tokens: ShareTokenService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  /** `GET /share-links` — her links with view counts and expiry (C-34). */
  async list(user: ICurrentUser): Promise<ShareLinkResponseDto[]> {
    const rows = await this.links.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });

    const now = new Date();
    const voteCounts = await this.voteCounts(rows.map((row) => row.id));

    return rows.map((row) =>
      toShareLinkResponse(row, {
        // Never re-issued: `tokenHash` is a digest, so the raw token is gone the
        // moment the creating response returns.
        url: null,
        voteCount: voteCounts.get(row.id) ?? 0,
        now,
      }),
    );
  }

  /**
   * `POST /share-links` — create a 30-day link (C-34).
   *
   * The raw token appears in this response and nowhere else, ever. Blocked entirely
   * while `sharing.enabled` is off (A-30) — minting a link that would refuse to open
   * is worse than refusing to mint it.
   */
  async create(user: ICurrentUser, dto: CreateShareLinkDto): Promise<ShareLinkResponseDto> {
    await this.assertSharingEnabled();

    const now = new Date();
    const active = await this.links.find({ where: { userId: user.id, revokedAt: IsNull() } });
    if (active.filter((link) => isLinkActive(link, now)).length >= MAX_ACTIVE_SHARE_LINKS) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: `You can keep up to ${MAX_ACTIVE_SHARE_LINKS} live links. Turn one off to add another.`,
        details: { limit: MAX_ACTIVE_SHARE_LINKS },
      });
    }

    const issued = this.tokens.issue();
    const link = this.links.create({
      userId: user.id,
      tokenHash: issued.hash,
      label: dto.label ?? null,
      expiresAt: new Date(now.getTime() + SHARE_LINK_TTL_DAYS * MILLISECONDS_PER_DAY),
      revokedAt: null,
      viewCount: 0,
      lastViewedAt: null,
    });

    const saved = await this.links.save(link);

    return toShareLinkResponse(saved, {
      url: this.tokens.urlFor(issued.raw),
      voteCount: 0,
      now,
    });
  }

  /**
   * `DELETE /share-links/:shareLinkId` — revoke immediately (C-34).
   *
   * Audited: a share link is the one thing in the product that hands a render to
   * somebody with no account, so both ends of its life are worth a row in the log.
   * Revoking an already-revoked link is `SHARE_LINK_REVOKED` rather than a silent
   * success — she is signed in and asking about her own link, and telling her it was
   * already off is more useful than pretending she just turned it off.
   */
  async revoke(user: ICurrentUser, shareLinkId: string): Promise<void> {
    const link = await this.loadOwned(user.id, shareLinkId);

    if (link.revokedAt !== null) {
      throw new ConflictException(ErrorCode.SHARE_LINK_REVOKED);
    }

    await this.links.update({ id: link.id, userId: user.id }, { revokedAt: new Date() });

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.SHARE_LINK_REVOKED,
        targetType: AUDIT_TARGET_TYPES.SHARE_LINK,
        actorId: user.id,
        actorRole: user.role,
        targetId: link.id,
        // Her own label for the link. No token, no digest, no recipient (E-12).
        targetLabel: link.label,
      }),
    );
  }

  /** `GET /share-links/:shareLinkId/votes` — what her recipients said (§5.14). */
  async listVotes(user: ICurrentUser, shareLinkId: string): Promise<ShareLinkVoteDto[]> {
    const link = await this.loadOwned(user.id, shareLinkId);

    const rows = await this.votes.find({
      where: { shareLinkId: link.id },
      order: { createdAt: 'ASC' },
    });

    if (rows.length === 0) {
      return [];
    }

    const garments = await this.garments.find({
      where: { id: In([...new Set(rows.map((row) => row.garmentId))]) },
    });
    const titleById = new Map(garments.map((garment) => [garment.id, garment.title]));

    return rows.map((row) => toShareLinkVote(row, titleById.get(row.garmentId) ?? ''));
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * One link, ownership-checked.
   *
   * Fetched by id alone so the difference between "no such link" and "somebody else's
   * link" can be logged; the client is told the same thing either way, because
   * `SHARE_LINK_NOT_OWNED` is masked to `SHARE_LINK_NOT_FOUND` (§2.4, S-9, E-7).
   */
  private async loadOwned(userId: string, shareLinkId: string): Promise<ShareLink> {
    const link = await this.links.findOne({ where: { id: shareLinkId } });

    if (link === null) {
      throw new NotFoundException(ErrorCode.SHARE_LINK_NOT_FOUND);
    }
    if (link.userId !== userId) {
      throw new OwnershipException(ErrorCode.SHARE_LINK_NOT_OWNED);
    }
    return link;
  }

  private async assertSharingEnabled(): Promise<void> {
    if (!(await this.settings.getBoolean(SETTINGS_KEYS.SHARING_ENABLED))) {
      throw new ForbiddenException(ErrorCode.SHARING_DISABLED);
    }
  }

  /** Vote totals for a page of links, in one query rather than one per link. */
  private async voteCounts(shareLinkIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (shareLinkIds.length === 0) {
      return counts;
    }

    const rows = await this.votes.find({ where: { shareLinkId: In([...shareLinkIds]) } });
    for (const row of rows) {
      counts.set(row.shareLinkId, (counts.get(row.shareLinkId) ?? 0) + 1);
    }
    return counts;
  }
}
