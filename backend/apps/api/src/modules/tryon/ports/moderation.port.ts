/**
 * DI token for {@link ModerationPort}.
 *
 * Bound in `TryOnModule` to an adapter over `ModerationQueueService`. A token rather than
 * the service itself, for the same reason `QUOTA_PORT` is one: the generation path should
 * see a single verb — "this photograph was rejected upstream, file it" — and not the A-34
 * queue's admin vocabulary.
 */
export const MODERATION_PORT = Symbol('MODERATION_PORT');

/** One upstream moderation verdict, as the runner saw it. */
export interface QueueModerationInput {
  /** `null` for an admin test render — a reference model, never a person (§4.15). */
  readonly personPhotoId: string | null;
  readonly userId: string | null;
  readonly jobId: string;
  /** The §8.3 code. */
  readonly reasonCode: string;
}

/**
 * The seam between `tryon` and `moderation` — §8.3's `queueModeration` behaviour.
 *
 * `TRYON_FAILURE_POLICY` marks `MODERATION_REJECTED` with `queueModeration: true` and the
 * flag was read by nothing, which made the taxonomy's most consequential row a comment.
 * Two things followed from that: A-34's queue was never fed, so no admin ever saw a
 * rejected photograph; and the photograph stayed `APPROVED`, so the guard chain passed it
 * again on the next attempt and it failed upstream again, at cost, forever.
 *
 * This is the one method that closes both. It never throws — a failure to file must not
 * replace the §8.3 error the consumer is owed.
 */
export interface ModerationPort {
  queueForReview(input: QueueModerationInput): Promise<void>;
}
