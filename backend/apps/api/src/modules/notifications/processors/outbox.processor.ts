import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { LessThan, LessThanOrEqual, Repository } from 'typeorm';

import { NotificationsService, type NotificationLocale, TemplateId } from '@library/notifications';

import { User } from '@api/modules/users/entities/user.entity';
import { Locale } from '@api/modules/users/enums/locale.enum';

import {
  MAX_LAST_ERROR_LENGTH,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_MAX_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_SENDING_TIMEOUT_MS,
  OUTBOX_TICK_MS,
} from '../constants/notification.constants';
import { NotificationOutboxEntry } from '../entities/notification-outbox-entry.entity';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationStatus } from '../enums/notification-status.enum';
import { storedProps } from '../utils/outbox-payload';

/** What one drain accomplished. Returned so a test can drive the loop deterministically. */
export interface DrainReport {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly reclaimed: number;
}

const EMPTY_REPORT: DrainReport = {
  claimed: 0,
  sent: 0,
  retried: 0,
  deadLettered: 0,
  reclaimed: 0,
};

/**
 * **The outbox drain — ARCHITECTURE §4.32.**
 *
 * > "Written inside the same transaction as the business change (transactional
 * > outbox), drained every 10 seconds by `notifications/processors/outbox.processor.ts`
 * > with exponential backoff and a cap of 5 attempts."
 *
 * ### Claim, then send. Never send, then claim.
 *
 * A tick begins by moving rows from `PENDING` to `SENDING` in **one conditional
 * `UPDATE`** that names the ids *and* re-asserts `status = PENDING`. Whichever tick
 * wins that update owns those rows; a second tick — or a second process, the day
 * there is one — sees zero rows affected and does nothing. Selecting first and
 * sending straight from the result set is the mistake this design exists to avoid:
 * two overlapping ticks would both read the same `PENDING` row and the consumer would
 * get the message twice.
 *
 * `@Interval` fires on a timer regardless of whether the previous tick finished, so
 * the conditional claim — not the timer — is what makes overlap harmless. The
 * `draining` flag on top of it is an optimisation, not the correctness argument.
 *
 * ### Retry, and where it stops
 *
 * A failed delivery goes back to `PENDING` with `availableAt = now + base * 2^(n-1)`,
 * capped at fifteen minutes. On the fifth failure the row becomes `FAILED` and is
 * never picked up again — the **dead letter**. It is not deleted: `lastError` and
 * `attempts` on a visible row are how an operator finds out that the SMS gateway has
 * been rejecting every message since Tuesday. A row that is retried forever hides
 * exactly that.
 *
 * A failure the provider has already classified as permanent — an undeliverable
 * address, rejected credentials — skips the retries and dead-letters immediately.
 * Four more attempts against an address that does not exist is four more minutes of
 * pretending.
 *
 * ### `IN_APP` never reaches a provider
 *
 * §4.32 makes the row itself the store. Delivering one means marking it `SENT`; the
 * consumer reads it through `GET /me/notifications`. There is nothing to time out and
 * nothing to retry, so it is settled without touching `NotificationsService` at all.
 */
@Injectable()
export class OutboxProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);

  /** Set on shutdown. A drain in flight finishes its row and then stops claiming. */
  private stopped = false;

  /** True while a drain is running. Cheap guard on top of the conditional claim. */
  private draining = false;

  constructor(
    @InjectRepository(NotificationOutboxEntry)
    private readonly outbox: Repository<NotificationOutboxEntry>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  /** §4.32 — every ten seconds. */
  @Interval(OUTBOX_TICK_MS)
  async tick(): Promise<void> {
    await this.drainOnce();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /**
   * Claims up to {@link OUTBOX_BATCH_SIZE} due rows and delivers them.
   *
   * Separated from {@link tick} so a test drives it without waiting on a timer, and so
   * the scheduled entry point contains nothing but the schedule.
   */
  async drainOnce(now: Date = new Date()): Promise<DrainReport> {
    if (this.draining || this.stopped) {
      return EMPTY_REPORT;
    }

    this.draining = true;
    try {
      const reclaimed = await this.reclaimStale(now);
      const claimed = await this.claim(now);

      let sent = 0;
      let retried = 0;
      let deadLettered = 0;

      for (const entry of claimed) {
        // A shutdown mid-batch leaves the remainder in SENDING; `reclaimStale` returns
        // them to the queue on the next boot rather than losing them.
        if (this.stopped) {
          break;
        }

        const outcome = await this.deliver(entry, now);
        if (outcome === 'SENT') {
          sent += 1;
        } else if (outcome === 'RETRY') {
          retried += 1;
        } else {
          deadLettered += 1;
        }
      }

      return { claimed: claimed.length, sent, retried, deadLettered, reclaimed };
    } finally {
      this.draining = false;
    }
  }

  /* -----------------------------------------------------------------------------------------
   * Claiming
   * -------------------------------------------------------------------------------------- */

  /**
   * Moves due `PENDING` rows into `SENDING` and returns **exactly the ones this call won**.
   *
   * ### Why the claim is one `UPDATE` per row, not one for the batch
   *
   * The predicate re-states `status = PENDING`, so a row already taken matches nothing.
   * That much is obvious. What is not obvious — and what an earlier draft of this method
   * got wrong — is that a *batched* claim cannot tell which rows it won: `UPDATE …
   * WHERE id IN (…) AND status = 'PENDING'` reports a count, and re-reading
   * `WHERE id IN (…) AND status = 'SENDING'` reads back every row in the batch,
   * including the ones the other worker just claimed. Two workers then both deliver the
   * overlap, which is precisely the failure this whole design exists to prevent.
   *
   * `affected === 1` on a single-row conditional update is unambiguous: this call moved
   * that row from `PENDING` to `SENDING` and nothing else did. Twenty-five small updates
   * on a ten-second timer is not a cost worth optimising against correctness.
   *
   * (`SELECT … FOR UPDATE SKIP LOCKED` is the other correct answer and is what this
   * should become when the outbox outgrows one process. It needs a query builder and a
   * transaction spanning the whole batch, which buys nothing while there is exactly one
   * API process (§8.2) — and the per-row claim is right in both worlds.)
   */
  private async claim(now: Date): Promise<NotificationOutboxEntry[]> {
    const due = await this.outbox.find({
      where: { status: NotificationStatus.PENDING, availableAt: LessThanOrEqual(now) },
      order: { availableAt: 'ASC', createdAt: 'ASC' },
      take: OUTBOX_BATCH_SIZE,
    });

    const claimed: NotificationOutboxEntry[] = [];

    for (const entry of due) {
      const result = await this.outbox.update(
        { id: entry.id, status: NotificationStatus.PENDING },
        { status: NotificationStatus.SENDING },
      );

      if ((result.affected ?? 0) === 1) {
        entry.status = NotificationStatus.SENDING;
        claimed.push(entry);
      }
    }

    return claimed;
  }

  /** Returns rows abandoned mid-delivery to the queue. See `OUTBOX_SENDING_TIMEOUT_MS`. */
  private async reclaimStale(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - OUTBOX_SENDING_TIMEOUT_MS);
    const result = await this.outbox.update(
      { status: NotificationStatus.SENDING, updatedAt: LessThan(cutoff) },
      { status: NotificationStatus.PENDING },
    );

    const reclaimed = result.affected ?? 0;
    if (reclaimed > 0) {
      this.logger.warn(
        `Returned ${reclaimed} notification(s) to the queue after a delivery was abandoned ` +
          'mid-flight. They may be delivered twice; `dedupeKey` is the control for messages ' +
          'that must not be.',
      );
    }
    return reclaimed;
  }

  /* -----------------------------------------------------------------------------------------
   * Delivery
   * -------------------------------------------------------------------------------------- */

  private async deliver(
    entry: NotificationOutboxEntry,
    now: Date,
  ): Promise<'SENT' | 'RETRY' | 'DEAD'> {
    if (entry.channel === NotificationChannel.IN_APP) {
      await this.markSent(entry, now);
      return 'SENT';
    }

    const address = await this.resolveAddress(entry);
    if (address === null) {
      // No address and no account to resolve one from. Retrying cannot invent one.
      return this.settleFailure(entry, now, 'No deliverable address for this recipient.', true);
    }

    let rendered: { subject: string; html: string; text: string };
    try {
      rendered = this.notifications.renderTemplate<TemplateId>({
        template: entry.template as TemplateId,
        props: storedProps(entry.payload),
        locale: this.localeOf(entry.locale),
      });
    } catch (error: unknown) {
      // A payload that no longer fits its template is a code defect, not an outage.
      return this.settleFailure(
        entry,
        now,
        `Template ${entry.template} could not be rendered: ${describe(error)}`,
        true,
      );
    }

    const result =
      entry.channel === NotificationChannel.SMS
        ? await this.notifications.sendSms({
            to: address,
            text: rendered.text,
            locale: this.localeOf(entry.locale),
            correlationId: entry.id,
            template: entry.template,
          })
        : await this.notifications.sendEmail({
            to: address,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            locale: this.localeOf(entry.locale),
            correlationId: entry.id,
            template: entry.template,
          });

    if (result.ok) {
      await this.markSent(entry, now);
      return 'SENT';
    }

    // `SendResult.failure` is optional on the type rather than discriminated by `ok`, so
    // a `!ok` result with no failure block is possible in the type even though the
    // library never produces one. Treated as retryable: an unclassified failure is an
    // unknown failure, and the honest default for an unknown failure is to try again.
    const failure = result.failure;
    return this.settleFailure(
      entry,
      now,
      failure === undefined
        ? 'The provider reported a failure with no classification.'
        : `${failure.code}: ${failure.message}`,
      failure !== undefined && !failure.retryable,
    );
  }

  /**
   * `SENT`, with the attempt counted.
   *
   * `sentAt` is what proves a message left; `readAt` stays null because an `IN_APP`
   * row is not read merely because it was delivered.
   */
  private async markSent(entry: NotificationOutboxEntry, now: Date): Promise<void> {
    await this.outbox.update(
      { id: entry.id },
      {
        status: NotificationStatus.SENT,
        sentAt: now,
        attempts: entry.attempts + 1,
        lastError: null,
      },
    );
  }

  /**
   * Either schedules the next attempt or dead-letters the row.
   *
   * `permanent` short-circuits the count: an address that does not exist will not
   * start existing on attempt four.
   */
  private async settleFailure(
    entry: NotificationOutboxEntry,
    now: Date,
    reason: string,
    permanent: boolean,
  ): Promise<'RETRY' | 'DEAD'> {
    const attempts = entry.attempts + 1;
    const exhausted = permanent || attempts >= OUTBOX_MAX_ATTEMPTS;
    const lastError = reason.slice(0, MAX_LAST_ERROR_LENGTH);

    if (exhausted) {
      await this.outbox.update(
        { id: entry.id },
        { status: NotificationStatus.FAILED, attempts, lastError },
      );
      this.logger.error(
        `Notification ${entry.id} (${entry.template}, ${entry.channel}) dead-lettered after ` +
          `${attempts} attempt(s): ${lastError}`,
      );
      return 'DEAD';
    }

    await this.outbox.update(
      { id: entry.id },
      {
        status: NotificationStatus.PENDING,
        attempts,
        lastError,
        availableAt: new Date(now.getTime() + backoffMs(attempts)),
      },
    );
    return 'RETRY';
  }

  /**
   * The address to write to.
   *
   * A stored `recipientAddress` wins; otherwise the account is read at delivery time,
   * which is deliberate — see {@link EnqueueNotificationInput.recipientAddress}.
   */
  private async resolveAddress(entry: NotificationOutboxEntry): Promise<string | null> {
    if (entry.recipientAddress !== null && entry.recipientAddress !== '') {
      return entry.recipientAddress;
    }
    if (entry.recipientUserId === null) {
      return null;
    }

    const user = await this.users.findOne({ where: { id: entry.recipientUserId } });
    if (user === null) {
      return null;
    }
    return entry.channel === NotificationChannel.SMS ? user.phone : user.email;
  }

  private localeOf(locale: Locale): NotificationLocale {
    return locale === Locale.UR ? 'UR' : 'EN';
  }
}

/** `base * 2^(attempts - 1)`, capped. Attempt 1 waits 30 s, attempt 4 waits four minutes. */
export function backoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** exponent, OUTBOX_BACKOFF_MAX_MS);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
