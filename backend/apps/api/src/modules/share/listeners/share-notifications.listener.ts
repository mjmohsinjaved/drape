import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Locale } from '@library/common';
import { NotificationsService, TemplateId } from '@library/notifications';

import { User } from '@api/modules/users/entities/user.entity';

import { SHARE_COMMENT_LEFT_EVENT, type ShareCommentLeftEvent } from '../events/share.events';

/**
 * Tells the consumer when someone she shared with leaves a comment (C-33).
 *
 * ### Why this is a listener and not part of `PublicShareService`
 *
 * The service that serves the recipient view is the one file in this module that must
 * never be able to reach the owner's account row — that is the third of C-33's
 * exclusions, and keeping `users` out of its injector makes it structural rather than
 * conventional. Sending her an email obviously *does* need her address, so that read
 * lives here, behind an event, on a path no public route returns anything from.
 *
 * The visitor-supplied fields travel as untrusted text and are escaped by the
 * template's layout. Nothing about the commenter beyond the label they typed is
 * available to send, which is correct: they have no account.
 *
 * **Seam.** Once `NotificationsModule`'s outbox lands (§4.32) this becomes an outbox
 * row written inside the vote's transaction, which also gives the consumer the in-app
 * copy. Until then it is a direct send, and a failed one is logged rather than thrown:
 * `NotificationsService` resolves rather than rejects (E-11), and a recipient's vote
 * must not fail because the studio's SMTP is down.
 */
@Injectable()
export class ShareNotificationsListener {
  private readonly logger = new Logger(ShareNotificationsListener.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(SHARE_COMMENT_LEFT_EVENT)
  async onCommentLeft(event: ShareCommentLeftEvent): Promise<void> {
    const { input } = event;

    const owner = await this.users.findOne({ where: { id: input.ownerId } });
    if (owner === null) {
      return;
    }

    const webUrl = this.config.getOrThrow<string>('APP_WEB_URL').replace(/\/+$/, '');

    const result = await this.notifications.sendTemplatedEmail({
      to: owner.email,
      template: TemplateId.SHARE_LINK_COMMENT,
      props: {
        consumerName: owner.name,
        commenterName: input.voterLabel,
        garmentTitle: input.garmentTitle,
        comment: input.comment,
        commentedAt: input.commentedAt,
        // Her own view of the shortlist she shared, not the recipient's link.
        shareUrl: `${webUrl}/shortlist`,
      },
      locale: owner.locale === Locale.UR ? 'UR' : 'EN',
      correlationId: input.shareLinkId,
    });

    if (!result.ok) {
      this.logger.warn(
        `Comment notification for share link ${input.shareLinkId} was not delivered ` +
          `(${result.failure?.code ?? 'UNKNOWN'}). The comment itself is committed and visible on her shortlist.`,
      );
    }
  }
}
