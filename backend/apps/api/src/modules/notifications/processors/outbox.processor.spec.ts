/**
 * ARCHITECTURE §4.32 — the outbox drain.
 *
 * Three properties are worth a test here, and they are the three that a hand-rolled
 * "send it at the end of the method" cannot have:
 *
 *  1. **a failed delivery is retried, with backoff** — the row goes back to `PENDING`
 *     with a later `availableAt`, and the attempt is counted;
 *  2. **retries stop** — the fifth failure dead-letters the row into `FAILED`, with the
 *     reason kept where an operator can read it. A row retried forever hides an outage;
 *  3. **nothing is ever sent twice** — two ticks racing over the same due row result in
 *     exactly one provider call, because the claim is a conditional `UPDATE` and the
 *     loser matches no rows.
 */
import {
  NotificationErrorCode,
  type NotificationsService,
  type SendResult,
} from '@library/notifications';

import type { User } from '@api/modules/users/entities/user.entity';
import { Locale } from '@api/modules/users/enums/locale.enum';

import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_SENDING_TIMEOUT_MS,
} from '../constants/notification.constants';
import { NotificationOutboxEntry } from '../entities/notification-outbox-entry.entity';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationStatus } from '../enums/notification-status.enum';

import { backoffMs, OutboxProcessor } from './outbox.processor';

import type { InMemoryRepository } from '../../../../test/fixtures';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const RECIPIENT = 'a1111111-1111-4111-8111-111111111111';

let sequence = 0;

function outboxRow(overrides: Partial<NotificationOutboxEntry> = {}): NotificationOutboxEntry {
  sequence += 1;
  return Object.assign(new NotificationOutboxEntry(), {
    id: `20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    channel: NotificationChannel.EMAIL,
    template: 'RENDER_READY',
    locale: Locale.EN,
    recipientUserId: RECIPIENT,
    recipientAddress: 'consumer@example.com',
    payload: {
      consumerName: 'Ayesha',
      garmentTitle: 'Anarkali in ivory',
      resultUrl: 'https://drape.test/results/1',
      tryOnsLeft: 3,
    },
    status: NotificationStatus.PENDING,
    attempts: 0,
    availableAt: NOW,
    sentAt: null,
    readAt: null,
    lastError: null,
    dedupeKey: null,
    ...overrides,
  });
}

function ok(): SendResult {
  return {
    ok: true,
    channel: 'EMAIL',
    provider: 'console-email',
    messageId: 'msg-1',
    recipient: 'c***@example.com',
    attempts: 1,
    durationMs: 4,
  };
}

function failed(retryable: boolean): SendResult {
  return {
    ok: false,
    channel: 'EMAIL',
    provider: 'console-email',
    messageId: null,
    recipient: 'c***@example.com',
    attempts: 1,
    durationMs: 4,
    failure: {
      code: retryable
        ? NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE
        : NotificationErrorCode.NOTIFICATION_INVALID_RECIPIENT,
      message: retryable ? 'connect ECONNREFUSED' : 'not a deliverable address',
      retryable,
    },
  };
}

interface Harness {
  readonly processor: OutboxProcessor;
  readonly outbox: InMemoryRepository<NotificationOutboxEntry>;
  readonly notifications: jest.Mocked<NotificationsService>;
}

function build(rows: readonly NotificationOutboxEntry[]): Harness {
  const outbox = createInMemoryRepository<NotificationOutboxEntry>({ rows });
  const users = createInMemoryRepository<User>();
  const notifications = createMock<NotificationsService>([
    'renderTemplate',
    'sendEmail',
    'sendSms',
  ]);

  notifications.renderTemplate.mockReturnValue({
    subject: 'Your try-on is ready',
    html: '<p>ready</p>',
    text: 'Drape\n\nYour try-on is ready\n\nOpen it to shortlist it.\n\n---\n\nDrape',
  });
  notifications.sendEmail.mockResolvedValue(ok());

  const processor = new OutboxProcessor(outbox, users, notifications);
  return { processor, outbox, notifications };
}

describe('OutboxProcessor', () => {
  describe('backoff', () => {
    it('doubles from the base and is capped (§4.32)', () => {
      expect(backoffMs(1)).toBe(OUTBOX_BACKOFF_BASE_MS);
      expect(backoffMs(2)).toBe(OUTBOX_BACKOFF_BASE_MS * 2);
      expect(backoffMs(3)).toBe(OUTBOX_BACKOFF_BASE_MS * 4);
      // The cap binds well before an unbounded exponent would.
      expect(backoffMs(20)).toBeLessThanOrEqual(15 * 60_000);
    });
  });

  describe('a delivery that succeeds', () => {
    it('marks the row SENT with a sentAt and counts the attempt', async () => {
      const { processor, outbox } = build([outboxRow()]);

      const report = await processor.drainOnce(NOW);

      expect(report).toMatchObject({ claimed: 1, sent: 1, retried: 0, deadLettered: 0 });
      expect(outbox.$rows[0]).toMatchObject({
        status: NotificationStatus.SENT,
        attempts: 1,
        sentAt: NOW,
        lastError: null,
      });
    });

    it('settles an IN_APP row without ever reaching a provider (§4.32)', async () => {
      const { processor, outbox, notifications } = build([
        outboxRow({ channel: NotificationChannel.IN_APP, recipientAddress: null }),
      ]);

      await processor.drainOnce(NOW);

      expect(notifications.sendEmail).not.toHaveBeenCalled();
      expect(notifications.sendSms).not.toHaveBeenCalled();
      expect(outbox.$rows[0].status).toBe(NotificationStatus.SENT);
    });
  });

  describe('a delivery that fails', () => {
    it('returns the row to PENDING with backoff, and counts the attempt', async () => {
      const { processor, outbox, notifications } = build([outboxRow()]);
      notifications.sendEmail.mockResolvedValue(failed(true));

      const report = await processor.drainOnce(NOW);

      expect(report).toMatchObject({ retried: 1, sent: 0, deadLettered: 0 });
      expect(outbox.$rows[0]).toMatchObject({
        status: NotificationStatus.PENDING,
        attempts: 1,
        sentAt: null,
      });
      expect(outbox.$rows[0].availableAt.getTime()).toBe(NOW.getTime() + backoffMs(1));
      expect(outbox.$rows[0].lastError).toContain('NOTIFICATION_PROVIDER_UNAVAILABLE');
    });

    it('dead-letters on the last permitted attempt and stops retrying', async () => {
      const { processor, outbox, notifications } = build([
        outboxRow({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }),
      ]);
      notifications.sendEmail.mockResolvedValue(failed(true));

      const report = await processor.drainOnce(NOW);

      expect(report).toMatchObject({ deadLettered: 1, retried: 0 });
      expect(outbox.$rows[0]).toMatchObject({
        status: NotificationStatus.FAILED,
        attempts: OUTBOX_MAX_ATTEMPTS,
      });

      // A dead letter is never picked up again — a later drain claims nothing.
      notifications.sendEmail.mockClear();
      const later = await processor.drainOnce(new Date(NOW.getTime() + 86_400_000));
      expect(later.claimed).toBe(0);
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('dead-letters immediately when the provider says the failure is permanent', async () => {
      const { processor, outbox, notifications } = build([outboxRow()]);
      notifications.sendEmail.mockResolvedValue(failed(false));

      const report = await processor.drainOnce(NOW);

      expect(report).toMatchObject({ deadLettered: 1 });
      expect(outbox.$rows[0]).toMatchObject({
        status: NotificationStatus.FAILED,
        // One attempt, not five: an address that does not exist will not start existing.
        attempts: 1,
      });
    });

    it('dead-letters a row whose template cannot be rendered rather than looping on it', async () => {
      const { processor, outbox, notifications } = build([outboxRow()]);
      notifications.renderTemplate.mockImplementation(() => {
        throw new Error('props do not fit this template');
      });

      await processor.drainOnce(NOW);

      expect(outbox.$rows[0].status).toBe(NotificationStatus.FAILED);
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('never double-sends', () => {
    it('delivers a due row exactly once when two drains race over it', async () => {
      const { processor, outbox, notifications } = build([outboxRow()]);

      // Two concurrent ticks. The claim is a conditional UPDATE re-asserting
      // `status = PENDING`, so only one of them can own the row.
      const second = new OutboxProcessor(outbox, createInMemoryRepository<User>(), notifications);

      await Promise.all([processor.drainOnce(NOW), second.drainOnce(NOW)]);

      expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
      expect(outbox.$rows[0].status).toBe(NotificationStatus.SENT);
      expect(outbox.$rows[0].attempts).toBe(1);
    });

    it('does not claim a row that is not due yet', async () => {
      const { processor, notifications } = build([
        outboxRow({ availableAt: new Date(NOW.getTime() + 60_000) }),
      ]);

      const report = await processor.drainOnce(NOW);

      expect(report.claimed).toBe(0);
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('does not re-enter itself while a drain is already running', async () => {
      const { processor, notifications } = build([outboxRow()]);
      let resolveSend: (result: SendResult) => void = () => undefined;
      notifications.sendEmail.mockReturnValue(
        new Promise<SendResult>((resolve) => {
          resolveSend = resolve;
        }),
      );

      const first = processor.drainOnce(NOW);
      const reentrant = await processor.drainOnce(NOW);
      expect(reentrant.claimed).toBe(0);

      resolveSend(ok());
      await first;
      expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('rows abandoned mid-delivery', () => {
    it('returns a stale SENDING row to the queue, but not a fresh one', async () => {
      const stale = outboxRow({
        status: NotificationStatus.SENDING,
        updatedAt: new Date(NOW.getTime() - OUTBOX_SENDING_TIMEOUT_MS - 1_000),
      });
      const fresh = outboxRow({ status: NotificationStatus.SENDING, updatedAt: NOW });
      const { processor, outbox } = build([stale, fresh]);

      const report = await processor.drainOnce(NOW);

      expect(report.reclaimed).toBe(1);
      expect(outbox.$rows.find((row) => row.id === fresh.id)?.status).toBe(
        NotificationStatus.SENDING,
      );
    });
  });
});
