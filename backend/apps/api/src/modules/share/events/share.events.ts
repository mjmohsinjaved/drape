/**
 * Domain events this module emits — named `domain.action` per §2.2.
 *
 * Emitted **after** the write commits. A listener that fires on a transaction which
 * later rolls back has told the world a lie — and in this case would have emailed a
 * consumer about a comment that does not exist.
 */

/** Someone the consumer shared with left a comment on one of her pieces (C-33). */
export const SHARE_COMMENT_LEFT_EVENT = 'share.comment-left';

/**
 * Everything the SHARE_LINK_COMMENT email needs.
 *
 * Deliberately **no recipient address and no owner name**: the listener resolves those
 * from `users` by `ownerId`. Putting an email address on an event payload is how one
 * ends up in a log line (E-12), and the visitor-supplied fields here — `voterLabel`
 * and `comment` — are untrusted input that the template escapes.
 */
export interface ShareCommentLeftInput {
  readonly shareLinkId: string;
  readonly ownerId: string;
  readonly garmentTitle: string;
  readonly voterLabel: string;
  readonly comment: string;
  readonly commentedAt: Date;
}

/** The typed envelope carried by {@link SHARE_COMMENT_LEFT_EVENT}. */
export class ShareCommentLeftEvent {
  constructor(readonly input: ShareCommentLeftInput) {}
}
