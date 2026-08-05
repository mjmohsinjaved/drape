import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Locale, Role, UserStatus } from '@library/common';
import { NotificationsService, TemplateId } from '@library/notifications';
import type { NotificationLocale } from '@library/notifications';

import { User } from '@api/modules/users/entities/user.entity';

import { Enquiry } from '../entities/enquiry.entity';
import {
  ENQUIRY_CREATED_EVENT,
  ENQUIRY_STATUS_CHANGED_EVENT,
  type EnquiryCreatedEvent,
  type EnquiryStatusChangedEvent,
} from '../events/enquiry.events';

/**
 * **A-25 notifications — "notification on new enquiry by email and in-app".**
 *
 * ### Why a listener
 *
 * Submitting an enquiry must not fail because SMTP is down (E-11), and the studio's
 * mail server must not be able to hold a consumer's request open. So the write commits
 * first, emits, and returns; this reacts. `NotificationsService` resolves rather than
 * rejects, and a failed send is logged rather than thrown — the enquiry exists either
 * way, and the admin sees it in the inbox regardless of whether the email arrived.
 *
 * ### Who is told what
 *
 * | Event | Recipient | Template |
 * | --- | --- | --- |
 * | created | every active admin | `NEW_ENQUIRY_ADMIN` |
 * | created | the consumer | `ENQUIRY_RECEIVED_CONSUMER` |
 * | status changed | the consumer | `ENQUIRY_STATUS_CHANGED` |
 *
 * The consumer templates carry the §9.4 shortlisting note; the admin one is
 * operator-facing. Neither is composed here — the copy lives in
 * `@library/notifications`, where it has already been through the §9.4 and §10.5
 * checks, and rewording it at a call site would put unchecked copy in front of a
 * consumer.
 *
 * The status email carries `studioNote: null`. A-24 makes internal notes admin-only,
 * and the template's own contract says the note it renders is "never an internal admin
 * note" — so nothing is passed rather than something being filtered.
 *
 * ### The seam
 *
 * **In-app is not delivered yet.** §4.32 makes `notifications_outbox` the store for
 * both channels — "`channel = IN_APP` rows are the in-app notification store, there is
 * no second table" — and that module has not landed. When it does, both handlers write
 * an outbox row (`EMAIL` and `IN_APP`) inside the originating transaction instead of
 * sending inline, and this file loses its direct dependency on `NotificationsService`.
 * Until then the email half of A-25 is delivered and the in-app half is queued behind
 * that module, which is a deliberate, visible gap rather than a silent one.
 */
@Injectable()
export class EnquiryNotificationsListener {
  private readonly logger = new Logger(EnquiryNotificationsListener.name);

  constructor(
    @InjectRepository(Enquiry)
    private readonly enquiries: Repository<Enquiry>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /** A-25 — tell the studio, and confirm to her (C-35). */
  // `{ async: true }` — the handler is `async`, and without the flag `emit()` never awaits
  // the promise it returns. Under `ignoreErrors: false` an unawaited rejection is not
  // reported *and* is not retried: an A-25 studio notification is silently dropped and the
  // consumer's C-35 confirmation with it. See `AuditListener`, which has always had it.
  @OnEvent(ENQUIRY_CREATED_EVENT, { async: true })
  async onCreated(event: EnquiryCreatedEvent): Promise<void> {
    const { input } = event;

    const enquiry = await this.enquiries.findOne({ where: { id: input.enquiryId } });
    if (enquiry === null) {
      return;
    }

    await Promise.all([this.notifyAdmins(enquiry, input), this.confirmToConsumer(enquiry, input)]);
  }

  /** A-22 / C-36 — tell her where things stand. */
  @OnEvent(ENQUIRY_STATUS_CHANGED_EVENT, { async: true })
  async onStatusChanged(event: EnquiryStatusChangedEvent): Promise<void> {
    const { input } = event;

    const consumer = await this.users.findOne({ where: { id: input.userId } });
    if (consumer === null) {
      return;
    }

    const result = await this.notifications.sendTemplatedEmail({
      to: consumer.email,
      template: TemplateId.ENQUIRY_STATUS_CHANGED,
      props: {
        enquiryReference: input.reference,
        previousStatus: input.from,
        currentStatus: input.to,
        // A-24: an internal note never reaches a consumer, so none is offered.
        studioNote: null,
        enquiryUrl: `${this.webUrl()}/enquiries/${input.enquiryId}`,
      },
      locale: this.localeOf(consumer),
      correlationId: input.enquiryId,
    });

    this.warnIfUndelivered(result.ok, 'Status update', input.reference, result.failure?.code);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async notifyAdmins(enquiry: Enquiry, input: EnquiryCreatedEvent['input']): Promise<void> {
    const admins = await this.users.find({
      where: { role: Role.ADMIN, status: UserStatus.ACTIVE },
    });

    for (const admin of admins) {
      const result = await this.notifications.sendTemplatedEmail({
        to: admin.email,
        template: TemplateId.NEW_ENQUIRY_ADMIN,
        props: {
          enquiryReference: enquiry.reference,
          consumerName: enquiry.contactName,
          eventType: enquiry.eventType ?? 'Not given',
          eventDate: enquiry.eventDate,
          budgetBand: enquiry.budgetBand,
          itemCount: input.itemCount,
          garmentTitles: input.garmentTitles,
          submittedAt: input.submittedAt,
          enquiryUrl: `${this.webUrl()}/admin/enquiries/${enquiry.id}`,
        },
        locale: this.localeOf(admin),
        correlationId: enquiry.id,
      });

      this.warnIfUndelivered(result.ok, 'Admin alert', enquiry.reference, result.failure?.code);
    }
  }

  private async confirmToConsumer(
    enquiry: Enquiry,
    input: EnquiryCreatedEvent['input'],
  ): Promise<void> {
    const consumer = await this.users.findOne({ where: { id: enquiry.userId } });
    if (consumer === null) {
      return;
    }

    const result = await this.notifications.sendTemplatedEmail({
      to: consumer.email,
      template: TemplateId.ENQUIRY_RECEIVED_CONSUMER,
      props: {
        consumerName: enquiry.contactName,
        enquiryReference: enquiry.reference,
        garmentTitles: input.garmentTitles,
        enquiryUrl: `${this.webUrl()}/enquiries/${enquiry.id}`,
      },
      locale: this.localeOf(consumer),
      correlationId: enquiry.id,
    });

    this.warnIfUndelivered(result.ok, 'Confirmation', enquiry.reference, result.failure?.code);
  }

  /** `getOrThrow` because §7 marks `APP_WEB_URL` required. */
  private webUrl(): string {
    return this.config.getOrThrow<string>('APP_WEB_URL').replace(/\/+$/, '');
  }

  private localeOf(user: User): NotificationLocale {
    return user.locale === Locale.UR ? 'UR' : 'EN';
  }

  private warnIfUndelivered(
    ok: boolean,
    what: string,
    reference: string,
    code: string | undefined,
  ): void {
    if (ok) {
      return;
    }
    this.logger.warn(
      `${what} for enquiry ${reference} was not delivered (${code ?? 'UNKNOWN'}). ` +
        'The enquiry itself is committed and visible in the admin inbox.',
    );
  }
}
