/**
 * The `notifications` module's public surface — ARCHITECTURE §4.32.
 *
 * ### For a module that needs to tell somebody something
 *
 * Take {@link OutboxService} and nothing else. Inside the transaction that makes the
 * announcement true:
 *
 * ```typescript
 * await runInTransaction(this.dataSource, async (manager) => {
 *   const enquiry = await manager.getRepository(Enquiry).save(draft);
 *   await this.outbox.enqueueWithin(manager, {
 *     template: TemplateId.NEW_ENQUIRY_ADMIN,
 *     props: { … },
 *     recipientUserId: adminId,
 *     locale: admin.locale,
 *     dedupeKey: `new-enquiry:${enquiry.id}:${adminId}`,
 *   });
 *   return enquiry;
 * });
 * ```
 *
 * `enqueueBothWithin` is the A-25 shape — "by email and in-app" — as two independent
 * rows, so a bounced address cannot take the in-app copy down with it.
 *
 * ### For a module that can detect an E-14 condition
 *
 * Take {@link AlertingService}. Only the module that owns the table can see the
 * condition: `moderation` sees the queue backlog and the authentication anomalies,
 * `retention` sees a failed purge, `analytics` sees the generation failure rate. The
 * budget thresholds arrive on their own, as `quota`'s domain events.
 *
 * ### Naming note for the composition root
 *
 * `@library/notifications` also exports a `NotificationsModule` — the transport
 * library. This is the feature module. `api.module.ts` needs an alias on one of the
 * two imports; the library is the one already there.
 *
 * **`NotificationsService` is deliberately not re-exported here.** A feature module
 * that reaches for it is sending inline, which is the thing this module exists to
 * replace: it defeats the transactional guarantee, it puts SMTP latency into a request
 * (E-11), and a failure loses the message with nothing left to say it should have been
 * sent. The only code that talks to a provider is {@link OutboxProcessor}.
 */
export { NotificationsModule } from './notifications.module';

export {
  OutboxService,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from './services/outbox.service';
export {
  AlertingService,
  type AuthenticationAnomalyAlertInput,
  type BudgetAlertInput,
  type GenerationFailureAlertInput,
  type ModerationBacklogAlertInput,
  type OperatorAlertTemplate,
  type PurgeFailureAlertInput,
} from './services/alerting.service';
export { NotificationsInboxService } from './services/notifications-inbox.service';
export { OutboxProcessor, backoffMs, type DrainReport } from './processors/outbox.processor';
export { BudgetAlertListener } from './listeners/budget-alert.listener';

export { NotificationOutboxEntry } from './entities/notification-outbox-entry.entity';
export { NotificationChannel } from './enums/notification-channel.enum';
export { NotificationStatus } from './enums/notification-status.enum';

export {
  NotificationCountResponseDto,
  NotificationResponseDto,
} from './dto/notification-response.dto';
export {
  NOTIFICATION_SORT_KEYS,
  NotificationIdParamDto,
  NotificationQueryDto,
  type NotificationSortKey,
} from './dto/notification-query.dto';

export {
  ALERT_DEDUPE_WINDOW_MS,
  ALERT_SWEEP_MS,
  GENERATION_FAILURE_MIN_SAMPLE,
  GENERATION_FAILURE_RATE_THRESHOLD,
  MAX_DEDUPE_KEY_LENGTH,
  MAX_LAST_ERROR_LENGTH,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_MAX_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_SENDING_TIMEOUT_MS,
  OUTBOX_TICK_MS,
} from './constants/notification.constants';

export {
  actionUrlOf,
  leadLineOf,
  toNotificationResponse,
  type RenderedNotificationCopy,
} from './mappers/notification.mapper';
export {
  isIsoTimestamp,
  reviveTimestamps,
  storedProps,
  toStoredPayload,
} from './utils/outbox-payload';
