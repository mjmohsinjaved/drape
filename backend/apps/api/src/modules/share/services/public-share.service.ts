import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, In, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  ForbiddenException,
  NotFoundException,
} from '@library/common';
import { isUniqueViolation, runInTransaction } from '@library/database';
import { StorageService } from '@library/storage';

import { SettingsService } from '@api/modules/settings';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { SharedShortlistResponseDto } from '../dto/shared-shortlist-response.dto';
import { ShareLink } from '../entities/share-link.entity';
import { Vote } from '../entities/vote.entity';
import { SHARE_COMMENT_LEFT_EVENT, ShareCommentLeftEvent } from '../events/share.events';
import { toSharedGarment, toVoteResponse } from '../mappers/share.mapper';
import { publicShareScope, SHARED_ITEM_ALIAS } from '../queries/public-share.scope';

import { ShareTokenService } from './share-token.service';

import type { CastVoteDto } from '../dto/cast-vote.dto';
import type { SharedGarmentDto } from '../dto/shared-shortlist-response.dto';
import type { VoteResponseDto } from '../dto/vote-response.dto';
import type { SharedShortlistRow } from '../queries/public-share.scope';

/** What a public call resolved to, plus the voter cookie the caller may need to set. */
export interface VisitorContext {
  /** The raw cookie value. Minted here when the visitor arrives without one. */
  readonly voterToken: string;
  /** True when the caller should write the cookie back. */
  readonly isNewVisitor: boolean;
}

/** A cast vote and the visitor context that produced it. */
export interface CastVoteResult {
  readonly vote: VoteResponseDto;
  readonly visitor: VisitorContext;
}

/** A recipient view and the visitor context that produced it. */
export interface SharedShortlistResult {
  readonly shortlist: SharedShortlistResponseDto;
  readonly visitor: VisitorContext;
}

/**
 * **The recipient view — PRD C-33, C-34, A-30; ARCHITECTURE §5.14, §4.21, §4.22.**
 *
 * ### The link is the whole authorisation, so the link is the whole surface
 *
 * There is no account behind these routes (C-33), which means the token is a bearer
 * credential and every question about what a holder may see has to be answered by
 * construction rather than by a role. Three properties carry it:
 *
 * 1. **The projection cannot reach anything private.** Every read goes through
 *    `queries/public-share.scope.ts` — the only query builder in this module — which
 *    joins no photo table, selects no `storageKey` and joins no `users` row. See that
 *    file's header for the three exclusions in full.
 * 2. **A bad link is always the same answer.** Revoked, expired and never-existed all
 *    return `SHARE_LINK_NOT_FOUND` (C-34, S-9). `SHARE_LINK_REVOKED` and
 *    `SHARE_LINK_EXPIRED` exist for the *owner's* view of her own links, where telling
 *    her which applies is the point; a recipient never sees either, because a guesser
 *    who can tell "revoked" from "no such link" has an oracle for enumerating tokens.
 * 3. **The toggle is checked before the token is.** A-30's `sharing.enabled` is read
 *    first, so a disabled instance answers `SHARING_DISABLED` for every token — valid
 *    or not — and the refusal itself leaks nothing.
 *
 * ### Reactions without an account
 *
 * A first-party cookie carries 256 random bits; `votes.voterFingerprint` stores its
 * sha256 (§4.22). It is not authentication — it stops a visitor accidentally voting
 * twice and lets them see what they already left. Someone determined to clear a cookie
 * can react again, and that is an acceptable outcome for a family group chat about
 * lehengas. What it must never do is let one recipient read another's comment, and
 * that is enforced by filtering on the fingerprint before anything is mapped.
 */
@Injectable()
export class PublicShareService {
  constructor(
    @InjectRepository(ShareLink)
    private readonly links: Repository<ShareLink>,
    @InjectRepository(Vote)
    private readonly votes: Repository<Vote>,
    @InjectRepository(ShortlistItem)
    private readonly items: Repository<ShortlistItem>,
    private readonly tokens: ShareTokenService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * `GET /share/:token` — the recipient view (C-33).
   *
   * Resolves the owner's **live** shortlist: §4.21 has no snapshot table, so a piece
   * she removes disappears from every link that showed it, and revoking is immediate.
   */
  async view(token: string, voterToken: string | undefined): Promise<SharedShortlistResult> {
    const link = await this.resolve(token);
    const visitor = this.visitor(voterToken);

    const rows = await this.sharedRows(link.userId);
    const items = await this.present(rows, link, visitor.voterToken);

    await this.recordView(link);

    const shortlist = new SharedShortlistResponseDto();
    shortlist.items = items;
    shortlist.itemCount = items.length;
    shortlist.expiresAt = link.expiresAt;

    return { shortlist, visitor };
  }

  /**
   * `GET /share/:token/votes` — "reactions already left under this link, so a recipient
   * sees their own" (§5.14).
   *
   * **Their own.** Scoped by fingerprint, not by link: a recipient reading the whole
   * link's comments would contradict what the owner is told in the share-link-comment
   * email, and would turn a private note into a group thread nobody opted into.
   */
  async ownVotes(token: string, voterToken: string | undefined): Promise<VoteResponseDto[]> {
    const link = await this.resolve(token);
    const visitor = this.visitor(voterToken);

    if (visitor.isNewVisitor) {
      return [];
    }

    const rows = await this.votes.find({
      where: {
        shareLinkId: link.id,
        voterFingerprint: this.tokens.fingerprint(visitor.voterToken),
      },
      order: { createdAt: 'ASC' },
    });

    return rows.map(toVoteResponse);
  }

  /**
   * `POST /share/:token/votes` — react, and leave one comment per item (C-33).
   *
   * The garment must be on **this** shortlist right now. A garment id from elsewhere
   * in the catalogue is `GARMENT_NOT_FOUND`: the vote table is reachable without an
   * account, and without this check it would be a public write surface keyed by any
   * uuid a visitor cared to type.
   */
  async castVote(
    token: string,
    dto: CastVoteDto,
    voterToken: string | undefined,
  ): Promise<CastVoteResult> {
    const link = await this.resolve(token);
    const visitor = this.visitor(voterToken);

    const rows = await this.sharedRows(link.userId);
    const shared = rows.find((row) => row.garmentId === dto.garmentId);
    if (shared === undefined) {
      throw new NotFoundException(ErrorCode.GARMENT_NOT_FOUND);
    }

    const fingerprint = this.tokens.fingerprint(visitor.voterToken);
    const { vote, commentAdded } = await this.upsertVote(link, fingerprint, dto);

    if (commentAdded) {
      // Emitted after the write commits (§2.9 rule 3). The listener that turns this
      // into the SHARE_LINK_COMMENT email lives in `share-notifications.service.ts`.
      this.events.emit(
        SHARE_COMMENT_LEFT_EVENT,
        new ShareCommentLeftEvent({
          shareLinkId: link.id,
          ownerId: link.userId,
          garmentTitle: shared.garmentTitle,
          voterLabel: vote.voterLabel,
          comment: vote.comment ?? '',
          commentedAt: vote.createdAt,
        }),
      );
    }

    return { vote: toVoteResponse(vote), visitor };
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Token → live link, or the one neutral refusal.
   *
   * The toggle is read **before** the lookup so that a disabled instance answers
   * identically for every token. After that there is exactly one failure mode:
   * `SHARE_LINK_NOT_FOUND`, for a token that never existed, one that has been revoked
   * and one that has expired alike (C-34).
   */
  private async resolve(token: string): Promise<ShareLink> {
    if (!(await this.settings.getBoolean(SETTINGS_KEYS.SHARING_ENABLED))) {
      throw new ForbiddenException(ErrorCode.SHARING_DISABLED);
    }

    const link = await this.links.findOne({ where: { tokenHash: this.tokens.hash(token) } });

    if (link === null || link.revokedAt !== null || link.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException(ErrorCode.SHARE_LINK_NOT_FOUND);
    }
    return link;
  }

  /** The visitor's cookie, or a fresh one for somebody arriving for the first time. */
  private visitor(voterToken: string | undefined): VisitorContext {
    if (voterToken === undefined || voterToken.length === 0) {
      return { voterToken: this.tokens.issueVoterToken(), isNewVisitor: true };
    }
    return { voterToken, isNewVisitor: false };
  }

  /**
   * The owner's live shortlist, through the one sanctioned query.
   *
   * `getRawMany` over an explicit `select`, so the rows carry the §4.21 columns and
   * nothing else — not her notes, not a full render key, not a photo reference.
   */
  private async sharedRows(ownerId: string): Promise<SharedShortlistRow[]> {
    return publicShareScope(
      this.items.createQueryBuilder(SHARED_ITEM_ALIAS),
      ownerId,
    ).getRawMany<SharedShortlistRow>();
  }

  /** Rows → recipient DTOs, with this visitor's own reactions folded in. */
  private async present(
    rows: readonly SharedShortlistRow[],
    link: ShareLink,
    voterToken: string,
  ): Promise<SharedGarmentDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const [showPrices, ownVotes] = await Promise.all([
      this.settings.getBoolean(SETTINGS_KEYS.CATALOG_SHOW_PRICES_PUBLICLY),
      this.votes.find({
        where: {
          shareLinkId: link.id,
          voterFingerprint: this.tokens.fingerprint(voterToken),
          garmentId: In(rows.map((row) => row.garmentId)),
        },
      }),
    ]);

    const voteByGarment = new Map(ownVotes.map((vote) => [vote.garmentId, vote]));

    return rows.map((row) =>
      toSharedGarment(row, {
        showPrices,
        // No subject: `thumbnails/render/**` is a public object class (§3.4), which is
        // what makes it issuable to somebody with no session. A `renders/**` key could
        // not be signed for a recipient at all, which is the point.
        sign: (key: string) => this.storage.signedUrl(key),
        ownVote: voteByGarment.get(row.garmentId),
      }),
    );
  }

  /**
   * View counting, deliberately advisory.
   *
   * A read-then-write rather than an atomic `increment`, because this number is shown
   * to the owner as "12 views" and not used to authorise, bill or rate-limit anything.
   * Two simultaneous opens may count as one; a lost count is a strictly better outcome
   * than a contended row on the hot path of a page anybody with the link can load.
   */
  private async recordView(link: ShareLink): Promise<void> {
    await this.links.update(
      { id: link.id },
      { viewCount: link.viewCount + 1, lastViewedAt: new Date() },
    );
  }

  /**
   * One vote row per `(link, visitor, garment)` — C-33's "one comment per item".
   *
   * `UQ_votes_link_voter_garment` is what actually enforces it. Two concurrent requests
   * can both see no row and both insert; the index refuses the loser with `23505`, and
   * the retry re-reads inside a fresh transaction — where the winner's row is now
   * visible — and applies the same rule it would have applied first time. Exactly one
   * retry: a second unique violation is not a race any more, it is a bug.
   */
  private async upsertVote(
    link: ShareLink,
    fingerprint: string,
    dto: CastVoteDto,
  ): Promise<{ vote: Vote; commentAdded: boolean }> {
    try {
      return await this.writeVote(link, fingerprint, dto);
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.writeVote(link, fingerprint, dto);
    }
  }

  private async writeVote(
    link: ShareLink,
    fingerprint: string,
    dto: CastVoteDto,
  ): Promise<{ vote: Vote; commentAdded: boolean }> {
    return runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<{ vote: Vote; commentAdded: boolean }> => {
        const repository = manager.getRepository(Vote);

        const existing = await repository.findOne({
          where: {
            shareLinkId: link.id,
            voterFingerprint: fingerprint,
            garmentId: dto.garmentId,
          },
        });

        if (existing !== null) {
          // §4.22: "A second comment on the same item by the same visitor is
          // VOTE_ALREADY_CAST; changing the reaction updates the row."
          if (dto.comment !== undefined && existing.comment !== null) {
            throw new ConflictException(ErrorCode.VOTE_ALREADY_CAST);
          }

          const commentAdded = dto.comment !== undefined;
          existing.reaction = dto.reaction;
          existing.voterLabel = dto.voterLabel;
          if (dto.comment !== undefined) {
            existing.comment = dto.comment;
          }

          return { vote: await repository.save(existing), commentAdded };
        }

        const row = repository.create({
          shareLinkId: link.id,
          garmentId: dto.garmentId,
          voterLabel: dto.voterLabel,
          voterFingerprint: fingerprint,
          reaction: dto.reaction,
          comment: dto.comment ?? null,
        });

        return { vote: await repository.save(row), commentAdded: dto.comment !== undefined };
      },
      { label: 'share.castVote' },
    );
  }
}
