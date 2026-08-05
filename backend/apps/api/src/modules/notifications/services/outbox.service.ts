import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, type EntityManager } from 'typeorm';

import { isUniqueViolation } from '@library/database';
import { TEMPLATE_REGISTRY, type TemplateId, type TemplatePropsMap } from '@library/notifications';

import { Locale } from '@api/modules/users/enums/locale.enum';

import { MAX_DEDUPE_KEY_LENGTH } from '../constants/notification.constants';
import { NotificationOutboxEntry } from '../entities/notification-outbox-entry.entity';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationStatus } from '../enums/notification-status.enum';
import { toStoredPayload } from '../utils/outbox-payload';

/**
 * What a feature module hands over instead of calling a provider.
 *
 * Generic on the template id, so `props` is checked against `TemplatePropsMap[K]` at
 * the call site. That check is the whole reason this interface is generic: once the
 * props are in `jsonb` nothing can verify them again, so they are verified on the way
 * in, by the compiler, at the only moment anyone still knows what they are.
 */
export interface EnqueueNotificationInput<K extends TemplateId> {
  readonly template: K;
  readonly props: TemplatePropsMap[K];
  /**
   * Omit to take the channel the copy was written for — `TEMPLATE_REGISTRY[template].channel`.
   * Pass `IN_APP` to put the same message in her in-app list as well (A-25 sends both).
   */
  readonly channel?: NotificationChannel;
  /** The account this is for. Required for `IN_APP` — it is the only addressing there is. */
  readonly recipientUserId?: string | null;
  /**
   * Email address or E.164 number. Optional: when a `recipientUserId` is given the
   * processor resolves the address from `users` at delivery time, which keeps one
   * fewer copy of a personal identifier in a table (E-12) and means a consumer who
   * corrects her address before the retry gets the message at the new one.
   */
  readonly recipientAddress?: string | null;
  readonly locale?: Locale;
  /**
   * Makes this message at-most-once. Backed by `UQ_notifications_outbox_dedupe`
   * (§4.32) — a second row with the same key is refused by the database, not by a
   * check-then-insert that would race.
   */
  readonly dedupeKey?: string | null;
  /** Hold the row back until this instant. Defaults to "as soon as the next tick runs". */
  readonly availableAt?: Date;
}

/** What {@link OutboxService.enqueue} reports back. */
export interface EnqueueResult {
  /** The row written, or `null` when `dedupeKey` matched one that already existed. */
  readonly id: string | null;
  /** true when the unique index refused this row because the message was already queued. */
  readonly deduplicated: boolean;
}

/**
 * **The transactional outbox — ARCHITECTURE §4.32, PRD A-25, E-11, E-14.**
 *
 * ### The property that makes this worth having
 *
 * A notification row is written **inside the transaction that made the thing it
 * announces true**, and delivered afterwards by a separate process. That single
 * change buys three guarantees that a direct `sendEmail()` at the end of a service
 * method cannot buy at all:
 *
 *  - **No message about something that did not happen.** An email sent inline, after
 *    the write but before the commit, survives a rollback. The studio then holds a
 *    confirmation for an enquiry that is not in the database.
 *  - **No lost message.** An inline send that fails takes the notification with it —
 *    the row is committed, the consumer is told nothing, and nothing anywhere
 *    remembers that she should have been. Here the row is committed with the work.
 *  - **No request paying for SMTP.** E-11: submitting an enquiry must not fail, or
 *    crawl, because the studio's mail server is slow. The insert is microseconds; the
 *    seven-second SMTP handshake happens on a timer, to nobody's request.
 *
 * ### How a caller uses it
 *
 * Inside a `runInTransaction` block, with the transactional manager:
 *
 * ```typescript
 * await runInTransaction(this.dataSource, async (manager) => {
 *   const enquiry = await manager.getRepository(Enquiry).save(draft);
 *   await this.outbox.enqueueWithin(manager, {
 *     template: TemplateId.ENQUIRY_RECEIVED_CONSUMER,
 *     props: { consumerName, enquiryReference, garmentTitles, enquiryUrl },
 *     recipientUserId: enquiry.userId,
 *     locale: consumer.locale,
 *     dedupeKey: `enquiry-received:${enquiry.id}`,
 *   });
 *   return enquiry;
 * });
 * ```
 *
 * {@link enqueue} is the same call outside a transaction, for the cases where there is
 * no business write to join — an operator alert, for instance.
 *
 * ### What this service does not do
 *
 * It never talks to a provider and never renders a template. Rendering happens in the
 * processor, at delivery time, so a consumer who changes her locale between the write
 * and the send is written to in the locale she has now.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(NotificationOutboxEntry)
    private readonly outbox: Repository<NotificationOutboxEntry>,
  ) {}

  /**
   * Appends a row **inside the caller's transaction**.
   *
   * This is the method every feature module should reach for. A dedupe collision is
   * *not* swallowed here and cannot be: swallowing it would need a `SAVEPOINT`, and
   * without one the caller's transaction is already aborted by the time the error is
   * caught. Callers inside a transaction should therefore use a `dedupeKey` that is
   * unique by construction (an entity id and an event name), and use {@link enqueue}
   * when the key is a time bucket that may legitimately collide.
   */
  async enqueueWithin<K extends TemplateId>(
    manager: EntityManager,
    input: EnqueueNotificationInput<K>,
  ): Promise<string> {
    const repository = manager.getRepository(NotificationOutboxEntry);
    const row = repository.create(this.draft(input));
    const saved = await repository.save(row);
    return saved.id;
  }

  /**
   * Appends a row on its own connection, tolerating a dedupe collision.
   *
   * Used by the alerting path (E-14), where the whole point of the key is that a
   * second alert inside the same window *should* collide and be dropped.
   */
  async enqueue<K extends TemplateId>(input: EnqueueNotificationInput<K>): Promise<EnqueueResult> {
    try {
      const saved = await this.outbox.save(this.outbox.create(this.draft(input)));
      return { id: saved.id, deduplicated: false };
    } catch (error: unknown) {
      // `UQ_notifications_outbox_dedupe` (§4.32) refusing the second alert *is* the
      // deduplication — a flag in memory would forget across a restart and a `SELECT`
      // first would race. Every other failure is a real failure and must surface, or a
      // dropped connection would be reported as "already enqueued".
      if (!isUniqueViolation(error)) {
        throw error;
      }
      this.logger.debug(
        `An identical notification was already queued (${String(input.template)}); ` +
          'the unique index dropped the duplicate.',
      );
      return { id: null, deduplicated: true };
    }
  }

  /**
   * Queues the same message on two channels — the A-25 shape, "by email and in-app".
   *
   * Two rows rather than one with a list of channels, because they are delivered
   * independently: a bounced email must not stop the in-app copy appearing, and a
   * dead-lettered email row must not drag the in-app row into the dead letter with it.
   */
  async enqueueBothWithin<K extends TemplateId>(
    manager: EntityManager,
    input: EnqueueNotificationInput<K> & { readonly recipientUserId: string },
  ): Promise<readonly string[]> {
    const primary = TEMPLATE_REGISTRY[input.template].channel;
    const channel = primary === 'SMS' ? NotificationChannel.SMS : NotificationChannel.EMAIL;

    return [
      await this.enqueueWithin(manager, { ...input, channel }),
      await this.enqueueWithin(manager, {
        ...input,
        channel: NotificationChannel.IN_APP,
        recipientAddress: null,
        dedupeKey:
          input.dedupeKey === null || input.dedupeKey === undefined
            ? null
            : `${input.dedupeKey}:in-app`,
      }),
    ];
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Builds the row.
   *
   * `IN_APP` rows carry no `recipientAddress` (§4.32) — the account *is* the address —
   * and an address handed in for one is dropped rather than stored, so a careless
   * caller cannot put an email address into a row that has no use for it (E-12).
   */
  private draft<K extends TemplateId>(
    input: EnqueueNotificationInput<K>,
  ): Partial<NotificationOutboxEntry> {
    const channel = input.channel ?? this.defaultChannelFor(input.template);
    const inApp = channel === NotificationChannel.IN_APP;

    return {
      channel,
      template: input.template,
      locale: input.locale ?? Locale.EN,
      recipientUserId: input.recipientUserId ?? null,
      recipientAddress: inApp ? null : (input.recipientAddress ?? null),
      payload: toStoredPayload(input.props),
      status: NotificationStatus.PENDING,
      attempts: 0,
      availableAt: input.availableAt ?? new Date(),
      sentAt: null,
      readAt: null,
      lastError: null,
      dedupeKey: truncate(input.dedupeKey, MAX_DEDUPE_KEY_LENGTH),
    };
  }

  /** The channel the copy was written for (`TemplateDefinition.channel`). */
  private defaultChannelFor(template: TemplateId): NotificationChannel {
    return TEMPLATE_REGISTRY[template].channel === 'SMS'
      ? NotificationChannel.SMS
      : NotificationChannel.EMAIL;
  }
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return value.length > max ? value.slice(0, max) : value;
}
