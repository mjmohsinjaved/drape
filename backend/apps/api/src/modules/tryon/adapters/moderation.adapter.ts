import { Injectable, Logger } from '@nestjs/common';

import { ModerationQueueService } from '@api/modules/moderation';

import type { ModerationPort, QueueModerationInput } from '../ports/moderation.port';

/**
 * The `MODERATION_PORT` binding — §8.3's `queueModeration` behaviour, executed.
 *
 * ### Why the failure is swallowed here rather than propagated
 *
 * This runs from `TryOnRunnerService.fail()`, which is already unwinding a generation that
 * went wrong. The consumer is owed the verbatim §8.3 message for `MODERATION_REJECTED` and
 * nothing else; replacing it with "the moderation queue was unavailable" would tell her
 * something about our infrastructure in place of the neutral copy §2.4 fixes for exactly
 * this case, and would tell her *more* about the moderation outcome than the design allows.
 *
 * So a filing failure is logged at error level — it is an operator problem, and A-34's
 * queue silently missing an item is worth an operator noticing — and the generation's own
 * error is what propagates.
 */
@Injectable()
export class ModerationQueueAdapter implements ModerationPort {
  private readonly logger = new Logger(ModerationQueueAdapter.name);

  constructor(private readonly queue: ModerationQueueService) {}

  async queueForReview(input: QueueModerationInput): Promise<void> {
    try {
      await this.queue.queueUpstreamRejection({
        personPhotoId: input.personPhotoId,
        userId: input.userId,
        jobId: input.jobId,
        reasonCode: input.reasonCode,
      });
    } catch (error: unknown) {
      this.logger.error(
        'An upstream moderation rejection could not be filed for review. The photograph may ' +
          'not be blocked, so the same generation can fail again at cost. ' +
          `jobId=${input.jobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
